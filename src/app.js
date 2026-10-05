import express from "express"; 
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
dotenv.config();
const morgan = require("morgan");

const app = express();

app.use(cors());
app.use(helmet());
app.use(morgan("dev"));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/api/v1/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Shivaye Luxury Cars API is running",
  });
});

export default app;