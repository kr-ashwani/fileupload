import express from "express";
import multer from "multer";
import StreamingFileCryptoModule from "./fileModule";
import cors from "cors";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(
  cors({
    origin: ["http://localhost:3000", "http://192.168.29.250:3000"],
    credentials: true, // Allow credentials
  })
);

// Initialize the StreamingFileCryptoModule
// Replace 'your-32-byte-secret-key-in-hex' with your actual encryption key
// Replace './encrypted-files' with the path to your encrypted files storage
const fileCrypto = new StreamingFileCryptoModule(
  "your-32-byte-secret-key-in-hex",
  "./encrypted-files"
);

// File upload route
app.post("/upload", upload.single("file-upload"), async (req, res) => {
  const data = req.body.metadata ? JSON.parse(req.body.metadata) : {};

  if (!req.file) {
    return res.status(400).send("No file uploaded.");
  }

  try {
    const fileBuffer = req.file.buffer;
    const metadata = {
      originalName: data.originalname,
      mimeType: data.fileType,
      size: data.size,
      fileId: data.fileId,
    };

    await fileCrypto.encryptAndSave(fileBuffer, metadata);
    res.send("file uploaded succesfully");
  } catch (error) {
    console.error("Error during file upload:", error);
    res.status(500).send("Error processing file upload");
  }
});

// File download route
app.get("/file", async (req, res) => {
  try {
    await fileCrypto.decryptAndStream(req, res);
  } catch (error) {
    console.error("Error processing file request:", error);
    res.status(404).send("File not found or error in processing");
  }
});

// Start the server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
