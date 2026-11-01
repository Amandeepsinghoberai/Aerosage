// Official CPCB PM2.5 sub-index (same maths as the backend) + a calm version of the official colours.
const BP = [[0, 30, 0, 50], [30, 60, 51, 100], [60, 90, 101, 200], [90, 120, 201, 300], [120, 250, 301, 400], [250, 380, 401, 500]];
export const BANDS = [
  { max: 50, name: "Good", color: "#3E9E6B", ink: "#fff" },
  { max: 100, name: "Satisfactory", color: "#98BF55", ink: "#1b2a12" },
  { max: 200, name: "Moderate", color: "#E5BD3D", ink: "#3a2f05" },
  { max: 300, name: "Poor", color: "#EB963A", ink: "#3a2005" },
  { max: 400, name: "Very poor", color: "#D4524C", ink: "#fff" },
  { max: 500, name: "Severe", color: "#8A2C3F", ink: "#fff" },
];
export function pm25ToAqi(pm) {
  if (pm == null || isNaN(pm)) return null;
  if (pm >= 380) return 500;
  for (const [lo, hi, a, b] of BP) if (pm <= hi) return Math.round(a + ((pm - lo) / (hi - lo)) * (b - a));
  return 500;
}
export const band = (aqi) => BANDS.find((b) => aqi <= b.max) || BANDS[5];
export const aqiColor = (aqi) => (aqi == null ? "#cfd6dc" : band(aqi).color);
export const fmtHour = (t) => {
  const d = new Date(t + ":00:00+05:30");
  return d.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", hour12: true, timeZone: "Asia/Kolkata" });
};
export const dayOffset = (i) => Math.floor(i / 24) - 7; // 2026-11-01 is D-7, Diwali (8 Nov) is D0
export const dayLabel = (off) => (off === 0 ? "Diwali" : off < 0 ? `D${off}` : `D+${off}`);
export const isNight = (t) => { const h = +t.slice(11, 13); return h >= 20 || h < 8; };

export function nowIndex(times) {
  const s = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" }); // "2026-11-01 03:32:10"
  const key = s.slice(0, 13).replace(" ", "T");
  const i = times.indexOf(key);
  return i >= 0 ? i : key < times[0] ? 0 : times.length - 1;
}
