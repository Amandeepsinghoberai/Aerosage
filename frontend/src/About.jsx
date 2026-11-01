import React from "react";

export default function About({ meta }) {
  const imp = meta.importance;
  return (
    <main className="page">
      <header className="pagehead">
        <h1>Delhi has 39 air monitors for about 3 crore people</h1>
        <p className="lead">Air changes street to street, and on Diwali it swings sharply. People get a reading for right now from the nearest monitor, not a forecast for where they are. AeroSage forecasts every 1.5 km box of Delhi, hour by hour, from 7 days before Diwali to 7 days after.</p>
      </header>
      <section className="card">
        <h2>How it works</h2>
        <ol className="steps">
          <li><b>Collect.</b> Nine years of hourly readings from 39 monitors, and the weather for the same hours.</li>
          <li><b>Learn.</b> A model studies past Diwalis: wind, how high the air mixes, temperature, season, time of day and place.</li>
          <li><b>Forecast.</b> It predicts every hour from 1 to 15 November 2026, with a low, likely and high value.</li>
          <li><b>Fill the gaps.</b> Boxes between monitors are estimated from the nearest ones, and shown fainter when a monitor is far away.</li>
          <li><b>Show.</b> This website reads the saved forecasts, so it stays fast when many people open it.</li>
        </ol>
      </section>
      <section className="card">
        <h2>What the model looks at</h2>
        <ul className="plain">
          <li><b>Diwali timing.</b> How close it is to Diwali night, and what each place was like on past Diwalis.</li>
          <li><b>Weather trap.</b> Low wind and low air mixing keep smoke near the ground.</li>
          <li><b>Farm-fire season.</b> The usual crop-burning pattern for this time of year.</li>
          <li><b>Traffic and routine.</b> Hour of day and weekday.</li>
          <li><b>Local area.</b> Where the monitor is.</li>
        </ul>
      </section>
      <section className="card">
        <h2>What we are honest about</h2>
        <table className="tbl">
          <thead><tr><th>Limit today</th><th>How we fix it</th></tr></thead>
          <tbody>
            <tr><td>Forecasts are saved, not live.</td><td>Connect a live monitor feed.</td></tr>
            <tr><td>Traffic is a guess from time of day.</td><td>Add real hourly traffic from a city partner.</td></tr>
            <tr><td>Farm smoke uses a seasonal pattern, not live fire counts.</td><td>Use NASA satellite fire detections.</td></tr>
            <tr><td>Boxes between monitors are estimates.</td><td>Shown faded, and tested by hiding one monitor at a time.</td></tr>
            <tr><td>The exact AQI band is right about 4 times in 10.</td><td>Use for planning and trends. The range shows the doubt.</td></tr>
          </tbody>
        </table>
      </section>
      <section className="card">
        <h2>Where the data comes from</h2>
        <p>Air quality: CPCB and DPCC monitors, via OpenCity. Weather: Open-Meteo. Satellite model used as a comparison: CAMS. Maps: OpenStreetMap.</p>
        <p className="muted small">Forecast issued {meta.issued_at}. All values are model estimates, not live sensor readings.</p>
      </section>
      <section className="card">
        <h2>The team</h2>
        <p>NexByte, Lovely Professional University: Amandeep Singh Oberai, Harpreet Singh, Sarthak Sharma and Devvansh Chaudhary. Built for the Root Access hackathon by Paryavaran Welfare Society.</p>
      </section>
    </main>
  );
}
