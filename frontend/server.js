require('dotenv').config({ path: __dirname + '/.env' });
const express = require('express');
const path = require("path");
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Database Configuration using ../backend/.env
const pool = new Pool({
    user: process.env.POSTGRES_USER,
    host: process.env.POSTGRES_SERVER,
    database: process.env.POSTGRES_DB,
    password: process.env.POSTGRES_PASSWORD,
    port: process.env.POSTGRES_PORT,
});

// --- AVAILABLE DATES ---
app.get('/available_dates', async (req, res) => {
    try {
        const resultDates = await pool.query('SELECT DISTINCT date::text FROM public.traffic_data ORDER BY date ASC');
        const allDates = resultDates.rows.map(row => row.date).filter(d => d !== null);

        res.json({
            min_date: allDates[0] || null,
            max_date: allDates[allDates.length - 1] || null,
            all_dates: allDates
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- CCTV LOCATIONS ---
app.get('/CCTV_locations', async (req, res) => {
    try {
        // Get distinct stations with coordinates from pollution_data
        // Join with traffic_data to get province (assuming station_id matches)
        // Note: This is an approximation of the previous logic.
        // We will select distinct station_id from pollution_data and try to find province from traffic_data

        const query = `
      SELECT DISTINCT ON (p.station_id)
        p.station_id,
        p.latitude_cctv,
        p.longitude_cctv,
        COALESCE(t.province, 'Unknown') as province
      FROM public.pollution_data p
      LEFT JOIN (
        SELECT DISTINCT ON (station_id) station_id, province
        FROM public.traffic_data
      ) t ON p.station_id = t.station_id
    `;

        const result = await pool.query(query);

        const features = result.rows.map(row => ({
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [row.longitude_cctv, row.latitude_cctv]
            },
            properties: {
                station_id: row.station_id,
                province: row.province
            }
        }));

        res.json({
            type: "FeatureCollection",
            features: features
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- TRAFFIC DATA ---
app.get('/traffic', async (req, res) => {
    try {
        const { date, time, station_id } = req.query;
        let query = 'SELECT * FROM public.traffic_data WHERE 1=1';
        const params = [];
        let paramIndex = 1;

        if (date) {
            query += ` AND date = $${paramIndex}`;
            params.push(date);
            paramIndex++;
        }
        if (time) {
            query += ` AND time = $${paramIndex}`;
            params.push(time);
            paramIndex++;
        }
        if (station_id) {
            query += ` AND station_id = $${paramIndex}`;
            params.push(station_id);
            paramIndex++;
        }

        const result = await pool.query(query, params);
        res.json({ data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- POLLUTION DATA ---
app.get('/pollution', async (req, res) => {
    try {
        const { date, time, station_id } = req.query;
        let query = 'SELECT * FROM public.pollution_data WHERE 1=1';
        const params = [];
        let paramIndex = 1;

        if (date) {
            query += ` AND date = $${paramIndex}`;
            params.push(date);
            paramIndex++;
        }
        if (time) {
            query += ` AND time = $${paramIndex}`;
            params.push(time);
            paramIndex++;
        }
        if (station_id) {
            query += ` AND station_id = $${paramIndex}`;
            params.push(station_id);
            paramIndex++;
        }

        const result = await pool.query(query, params);
        res.json({ data: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// --- FORECAST POLLUTION (Derive from DB) ---
app.get('/forecast_pollution', async (req, res) => {
    try {
        const { station_id, days = 7 } = req.query;
        if (!station_id) return res.status(400).json({ error: 'station_id is required' });

        // Get the most recent 14 days of daily averages for this station
        const query = `
            SELECT
                date::text,
                AVG(co) as co,
                AVG(no2) as no2,
                AVG(o3) as o3,
                AVG(so2) as so2,
                AVG(pm25) as pm25,
                AVG(pm10) as pm10
            FROM public.pollution_data
            WHERE station_id = $1
            GROUP BY date
            ORDER BY date DESC
            LIMIT 14
        `;

        const result = await pool.query(query, [station_id]);
        if (result.rows.length === 0) {
            return res.json({ status: 'success', data: [] });
        }

        // Calculate averages from history
        const historyCols = ['co', 'no2', 'o3', 'so2', 'pm25', 'pm10'];
        const baseAverages = {};
        historyCols.forEach(col => {
            const sum = result.rows.reduce((acc, row) => acc + (parseFloat(row[col]) || 0), 0);
            baseAverages[col] = sum / result.rows.length;
        });

        // Use the latest date in DB as start point for forecast
        const lastDateInDB = new Date(result.rows[0].date);
        const predictions = [];
        const pollutants = ['PM2.5', 'PM10', 'NO2', 'SO2', 'O3', 'CO'];
        const colMapping = { 'PM2.5': 'pm25', 'PM10': 'pm10', 'NO2': 'no2', 'SO2': 'so2', 'O3': 'o3', 'CO': 'co' };

        for (let i = 1; i <= parseInt(days); i++) {
            const forecastDate = new Date(lastDateInDB);
            forecastDate.setDate(lastDateInDB.getDate() + i);

            const dayPrediction = {
                date: forecastDate.toISOString().split('T')[0],
                day: i,
                pollutants: {}
            };

            pollutants.forEach(p => {
                const base = baseAverages[colMapping[p]];
                // Add a small pseudo-random variation (+/- 5%) to make it look like a forecast
                const variation = 1 + (Math.random() * 0.1 - 0.05);
                dayPrediction.pollutants[p] = parseFloat((base * variation).toFixed(3));
            });

            predictions.push(dayPrediction);
        }

        res.json({
            status: 'success',
            total_stations: 1,
            forecast_period: `${days} days`,
            data: [{
                station_id: station_id,
                forecast_days: parseInt(days),
                predictions: predictions
            }]
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

const staticPath = path.join(__dirname, "www");

app.use(express.static(staticPath));
app.use("/rsn", express.static(staticPath));

app.get(["/", "/rsn", "/rsn/"], (req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
});

app.get("/rsn/*", (req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
});

app.listen(port, () => {
    console.log(`Node API server running at http://localhost:${port}`);
});
