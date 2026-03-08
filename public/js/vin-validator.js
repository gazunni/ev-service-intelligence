
const transliteration={A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,J:1,K:2,L:3,M:4,N:5,P:7,R:9,S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9};
const weights=[8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];

export function validateVINFormat(vin){
 if(!vin) throw new Error("Please enter a VIN");
 vin=vin.trim().toUpperCase();
 if(vin.length!==17) throw new Error("VIN must contain exactly 17 characters");
 if(/[^A-HJ-NPR-Z0-9]/.test(vin)) throw new Error("VIN contains invalid characters");
 return vin;
}

export function validateVINChecksum(vin){
 let sum=0;
 for(let i=0;i<17;i++){
  const c=vin[i];
  const v=isNaN(c)?transliteration[c]:parseInt(c);
  sum+=v*weights[i];
 }
 const r=sum%11;
 const check=r===10?"X":r.toString();
 if(vin[8]!==check) throw new Error("VIN checksum validation failed");
 return true;
}

export function decodeVIN(vin){
 const wmi=vin.substring(0,3);
 const yearCode=vin[9];
 const yearMap={A:2010,B:2011,C:2012,D:2013,E:2014,F:2015,G:2016,H:2017,J:2018,K:2019,L:2020,M:2021,N:2022,P:2023,R:2024,S:2025,T:2026,V:2027,W:2028,X:2029,Y:2030};
 return {vin,wmi,year:yearMap[yearCode]||null};
}

export function validateVINContext(decoded,ctx){
 if(!decoded.year) throw new Error("VIN year code could not be decoded");
 if(ctx.year && decoded.year!=ctx.year){
  return {valid:false,message:`VIN is for model year ${decoded.year} but ${ctx.year} was selected`};
 }
 return {valid:true};
}


// --- VIN Context Enforcement ---
export function enforceVINContext(decoded, ctx){
  const result={
    state:"matched",
    message:null
  };

  if(!decoded || !decoded.year){
    result.state="invalid";
    result.message="VIN year could not be decoded";
    return result;
  }

  const selectedYear=parseInt(ctx.year);
  if(selectedYear && decoded.year!==selectedYear){
    result.state="mismatch";
    result.message=`VIN mismatch: decoded year ${decoded.year} but dashboard year ${selectedYear}`;
    return result;
  }

  return result;
}
