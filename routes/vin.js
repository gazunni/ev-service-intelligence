import express from 'express'
import { query } from '../services/database.js'
import { fetchVINRecalls } from '../services/nhtsa.js'

const router=express.Router()

router.post('/lookup',async(req,res)=>{
  try{
    const {vin}=req.body
    if(!vin){return res.status(400).json({error:'vin required'})}
    const recalls=await fetchVINRecalls(vin)
    const campaigns=recalls.map(r=>r.campaign)
    const existing=await query(`SELECT id FROM recalls WHERE id=ANY($1)`,[campaigns])
    const existingSet=new Set(existing.rows.map(r=>r.id))
    const missing=recalls.filter(r=>!existingSet.has(r.campaign))
    res.json({recalls,missing})
  }catch(err){
    console.error(err)
    res.status(500).json({error:'vin lookup failed'})
  }
})

router.post('/import',async(req,res)=>{
  try{
    const {vin,vehicle,year}=req.body
    if(!vin || !vehicle || !year){return res.status(400).json({error:'vin vehicle year required'})}
    const recalls=await fetchVINRecalls(vin)
    let inserted=0
    for(const r of recalls){
      const result=await query(
        `INSERT INTO recalls (id,vehicle_key,year,title,risk,remedy,source_pills,raw_nhtsa)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT(id) DO NOTHING
         RETURNING id`,
        [r.campaign,vehicle,year,r.title,r.risk||'',r.remedy||'',['VIN'],r]
      )
      if(result.rowCount>0){inserted++}
    }
    res.json({ok:true,inserted})
  }catch(err){
    console.error(err)
    res.status(500).json({error:'vin import failed'})
  }
})

export default router
