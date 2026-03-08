
import{validateVINFormat,validateVINChecksum,decodeVIN,validateVINContext,enforceVINContext}from"./js/vin-validator.js";

window.runVehicleLookup=async function(){
 const vinInput=document.getElementById("vinInput");
 const errorPanel=document.getElementById("vinLookupError");
 if(errorPanel) errorPanel.style.display="none";
 try{
  const vin=validateVINFormat(vinInput.value);
  validateVINChecksum(vin);
  const decoded=decodeVIN(vin);
  const ctx={
   make:document.getElementById("makeSelect")?.value,
   model:document.getElementById("modelSelect")?.value,
   year:document.getElementById("yearSelect")?.value
  };

  const enforce=enforceVINContext(decoded,ctx);
  if(enforce.state!=="matched"){
     showLookupError(enforce.message);
     return;
  }

  const check=validateVINContext(decoded,ctx);
  if(!check.valid){showLookupError(check.message);return;}

  openVehicleDetail(vin);
 }catch(err){showLookupError(err.message);}
};

function showLookupError(msg){
 const p=document.getElementById("vinLookupError");
 if(!p){console.warn(msg);return;}
 p.innerText=msg;
 p.style.display="block";
}
