import express from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { pipeline, Transform } from "stream";
import { promisify } from "util";
import mime from "mime-types";
import busboy from "busboy";

const pipelineAsync = promisify(pipeline);

export class StreamingFileCryptoModule {
  private encryptionKey: Buffer;
  private storagePath: string;
  private algorithm: string = "aes-256-cbc";
  private blockSize: number = 16;

  constructor(encryptionKey: string, storagePath: string) {
    this.encryptionKey = crypto.scryptSync(encryptionKey, "salt", 32);
    this.storagePath = storagePath;
  }
  async processFileAndEncrypt(req: express.Request, res: express.Response) {
    const bb = busboy({ headers: req.headers });
    //console.log(metadata);

    bb.on("file", (name: string, file: any, info: any) => {
      const metadata: any = {
        originalName: info.filename,
        mimeType: info.mimeType,
        fileId: req.query.fileId, // Use provided fileId or generate a new one
      };
      console.log(metadata);

      this.encryptAndSave(file, metadata)
        .then(() => {
          res.json({ fileId: metadata.fileId, message: "File uploaded successfully" });
        })
        .catch((error) => {
          console.error("Error during file upload:", error);
          res.status(500).send("Error processing file upload");
        });
    });

    bb.on("error", (error: any) => {
      console.error("Error parsing form:", error);
      res.status(500).send("Error processing upload");
    });

    req.pipe(bb);
  }
  async encryptAndSave(readStream: NodeJS.ReadableStream, metadata: any): Promise<void> {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.encryptionKey, iv);
    const filePath = path.join(this.storagePath, `${metadata.fileId}.enc`);
    const writeStream = fs.createWriteStream(filePath);

    writeStream.write(iv);
    await pipelineAsync(readStream, cipher, writeStream);
  }

  private createDecryptStream(key: Buffer, iv: Buffer, start: number = 0): Transform {
    let decipher = crypto.createDecipheriv(this.algorithm, key, iv);
    let buffer = Buffer.alloc(0);
    let startOffset = start % this.blockSize;
    const blockSize = this.blockSize;

    return new Transform({
      transform(chunk: Buffer, encoding, callback) {
        buffer = Buffer.concat([buffer, chunk]);

        while (buffer.length >= blockSize) {
          const decryptChunk = buffer.slice(0, blockSize);
          buffer = buffer.slice(blockSize);

          let decrypted = decipher.update(decryptChunk);

          if (startOffset > 0) {
            decrypted = decrypted.slice(startOffset);
            startOffset = 0;
          }

          this.push(decrypted);
        }

        callback();
      },
      flush(callback) {
        if (buffer.length > 0) {
          let decrypted = decipher.update(buffer);
          this.push(decrypted);
        }

        try {
          const final = decipher.final();
          this.push(final);
        } catch (err) {
          console.error("Error in decipher final:", err);
        }

        callback();
      },
    });
  }

  async decryptAndStream(req: express.Request, res: express.Response): Promise<void> {
    const metadata = req.query as any;
    const filePath = path.join(this.storagePath, `${metadata.fileId}.enc`);

    if (!fs.existsSync(filePath)) {
      res.status(404).send("File not found");
      return;
    }

    const stat = fs.statSync(filePath);
    const encryptedFileSize = stat.size;
    const actualFileSize = parseInt(metadata.size, 10);

    // Determine content type based on file extension or metadata
    const fileExtension = path.extname(metadata.originalName || "").toLowerCase();
    const contentType =
      metadata.mimeType || mime.lookup(metadata.originalName) || "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Accept-Ranges", "bytes");

    // Set additional headers for certain file types
    if (contentType.startsWith("image/")) {
      res.setHeader("Content-Disposition", `inline; filename="${metadata.originalName}"`);
    } else if (
      contentType === "application/pdf" ||
      contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      res.setHeader("Content-Disposition", `inline; filename="${metadata.originalName}"`);
    } else {
      res.setHeader("Content-Disposition", `attachment; filename="${metadata.originalName}"`);
    }

    const range = req.headers.range;
    let start = 0;
    let end = actualFileSize - 1;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      start = parseInt(parts[0], 10);
      end = parts[1] ? parseInt(parts[1], 10) : actualFileSize - 1;

      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${actualFileSize}`);
    }

    let chunkSize = end - start + 1;
    res.setHeader("Content-Length", chunkSize);

    const ivSize = 16;
    const encryptedStart = Math.floor(start / this.blockSize) * this.blockSize;

    const readStream = fs.createReadStream(filePath, {
      start: encryptedStart + ivSize,
      end: encryptedFileSize - 1,
      highWaterMark: 64 * 1024, // 64KB chunks
    });

    const iv = Buffer.alloc(ivSize);
    await new Promise<void>((resolve, reject) => {
      fs.read(fs.openSync(filePath, "r"), iv, 0, ivSize, 0, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const decryptStream = this.createDecryptStream(this.encryptionKey, iv, encryptedStart);
    const blockSize = this.blockSize;
    const trimStream = new Transform({
      transform(chunk: Buffer, encoding, callback) {
        if (start > 0) {
          const startOffset = start % blockSize;
          chunk = chunk.slice(startOffset);
          start = 0;
        }
        if (chunk.length > chunkSize) {
          chunk = chunk.slice(0, chunkSize);
        }
        chunkSize -= chunk.length;
        this.push(chunk);
        callback();
      },
    });

    res.on("close", () => {
      readStream.destroy();
    });

    try {
      await pipelineAsync(readStream, decryptStream, trimStream, res);
    } catch (error: any) {
      if (error.code !== "ERR_STREAM_PREMATURE_CLOSE") {
        console.error("Error in decryptAndStream:", error.message);
        if (!res.headersSent) {
          res.status(500).send("Internal Server Error");
        }
      }
    }
  }

  async handleDownload(req: express.Request, res: express.Response) {
    const metadata = req.query as any;
    const fileId = metadata.fileId;

    if (!metadata.originalName || isNaN(metadata.size) || !metadata.mimeType) {
      return res.status(400).send("Invalid request parameters");
    }

    const filePath = path.join(this.storagePath, `${fileId}.enc`);

    if (!fs.existsSync(filePath)) {
      return res.status(404).send("File not found");
    }

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(metadata.originalName)}"`
    );
    res.setHeader("Content-Type", metadata.mimeType || "application/octet-stream");
    res.setHeader("Content-Length", metadata.size);

    const ivSize = 16;
    const iv = Buffer.alloc(ivSize);
    await new Promise<void>((resolve, reject) => {
      fs.read(fs.openSync(filePath, "r"), iv, 0, ivSize, 0, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const readStream = fs.createReadStream(filePath);
    const decipher = crypto.createDecipheriv(this.algorithm, this.encryptionKey, iv);

    try {
      await pipeline(readStream, decipher, res);
    } catch (error) {
      console.error("Download failed:", error);
      if (!res.headersSent) {
        res.status(500).send("Download failed");
      }
    }
  }
}
