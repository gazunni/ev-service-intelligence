
import {
  validateVINFormat,
  validateVINChecksum,
  decodeVIN,
  validateVINContext
} from "./js/vin-validator.js";

window.runVehicleLookup = async function () {

  const vinInput = document.getElementById("vinInput");
  const errorPanel = document.getElementById("vinLookupError");

  errorPanel.style.display = "none";

  try {

    const vin = validateVINFormat(vinInput.value);

    validateVINChecksum(vin);

    const decodedVIN = decodeVIN(vin);

    const context = {
      make: document.getElementById("makeSelect")?.value,
      model: document.getElementById("modelSelect")?.value,
      year: document.getElementById("yearSelect")?.value
    };

    const validation = validateVINContext(decodedVIN, context);

    if (!validation.valid) {
      showLookupError(validation.message);
      return;
    }

    openVehicleDetail(vin);

  }
  catch (err) {
    showLookupError(err.message);
  }

};

function showLookupError(message) {

  const panel = document.getElementById("vinLookupError");

  if (!panel) {
    console.warn("VIN error panel missing:", message);
    return;
  }

  panel.innerText = message;
  panel.style.display = "block";

}
