// General guidance by AQI band and person type. Static on purpose: it is not a model output and not medical advice.
export const PERSONS = ["Everyone", "Children", "Older adults", "Asthma or heart conditions", "Pregnancy", "Outdoor workers"];
const base = {
  Good: "Air is clean. Normal outdoor activity is fine.",
  Satisfactory: "Fine for most people. Unusually sensitive people may notice mild discomfort.",
  Moderate: "Cut back on long, hard exercise outdoors if you have breathing or heart problems.",
  Poor: "Avoid long outdoor activity. Keep windows closed in the evening and carry a mask for trips outside.",
  "Very poor": "Stay indoors where you can. Close windows, run an air purifier if you have one, and wear an N95 mask outside.",
  Severe: "Stay indoors. No outdoor exercise. Wear an N95 mask if you must go out, and see a doctor if breathing gets difficult.",
};
const extra = {
  Children: { Good: "Normal play is fine.", Satisfactory: "Normal play is fine.", Moderate: "Shorten outdoor sports.", Poor: "Move games and sports indoors.", "Very poor": "Keep children indoors, including school breaks.", Severe: "Keep children indoors. Watch for coughing or wheezing." },
  "Older adults": { Good: "Normal activity.", Satisfactory: "Normal activity.", Moderate: "Take walks at midday when the air is cleaner.", Poor: "Skip long walks. Rest if you feel breathless.", "Very poor": "Stay in. Call your doctor if you feel chest tightness.", Severe: "Stay in. Seek care for chest pain or breathlessness." },
  "Asthma or heart conditions": { Good: "Normal activity.", Satisfactory: "Keep your reliever inhaler with you.", Moderate: "Keep your reliever inhaler close. Avoid heavy exertion.", Poor: "Stay indoors where possible and follow your action plan.", "Very poor": "Stay indoors. Use medication as prescribed and seek care early.", Severe: "Stay indoors. Seek care early if symptoms rise." },
  Pregnancy: { Good: "Normal activity.", Satisfactory: "Normal activity.", Moderate: "Prefer indoor exercise.", Poor: "Limit time outdoors and wear a mask.", "Very poor": "Stay indoors and wear an N95 mask if you must go out.", Severe: "Stay indoors and speak to your doctor if you feel unwell." },
  "Outdoor workers": { Good: "Normal work.", Satisfactory: "Normal work.", Moderate: "Take breaks indoors when you can.", Poor: "Wear a mask and take regular breaks away from smoke.", "Very poor": "Wear an N95 mask and limit hours in heavy smoke.", Severe: "Wear an N95 mask. Limit exposure and rest often." },
};
export function advice(bandName, person) {
  return person === "Everyone" ? base[bandName] : `${extra[person][bandName]} ${base[bandName]}`;
}
