import express from "express";
import cors from "cors";

import { StreamingFileCryptoModule } from "./fileModule";

const app = express();

app.use(
  cors({
    origin: ["http://localhost:3000", "http://192.168.29.250:3000"],
    credentials: true, // Allow credentials
  })
);

const fileCrypto = new StreamingFileCryptoModule(
  process.env.ENCRYPTION_KEY || "your-32-byte-secret-key-in-hex",
  "./encrypted-files"
);

app.post("/upload", (req, res) => {
  try {
    fileCrypto.processFileAndEncrypt(req, res);
  } catch (error) {
    console.error("Error processing file request:", error);
    res.status(404).send("File not found or error in processing");
  }
});

app.get("/file", async (req, res) => {
  try {
    await fileCrypto.decryptAndStream(req, res);
  } catch (error) {
    console.error("Error processing file request:", error);
    res.status(404).send("File not found or error in processing");
  }
});

app.get("/download", (req, res) => {
  try {
    fileCrypto.handleDownload(req, res);
  } catch (error) {
    console.error("Error processing file request:", error);
    res.status(404).send("File not found or error in processing");
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
