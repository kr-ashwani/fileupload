import * as crypto from "crypto";
import { Request, Response } from "express";
import * as fs from "fs";
import mime from "mime";
import * as path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

class StreamingFileCryptoModule {
  private encryptionKey: Buffer;
  private storagePath: string;
  private algorithm: string = "aes-256-cbc";

  constructor(encryptionKey: string, storagePath: string) {
    this.encryptionKey = crypto.scryptSync(encryptionKey, "salt", 32);
    this.storagePath = storagePath;
  }

  async encryptAndSave(readStream: fs.ReadStream, metadata: any): Promise<void> {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.encryptionKey, iv);
    const filePath = path.join(this.storagePath, metadata.fileId);
    const writeStream = fs.createWriteStream(filePath);

    // Write IV at the beginning of the file
    writeStream.write(iv);

    await pipeline(readStream, cipher, writeStream);
  }

  async decryptAndStream(req: Request, res: Response): Promise<void> {
    const fileId = req.query.fileId as string;
    const filePath = path.join(this.storagePath, fileId);

    // Read metadata
    const metadata = req.query as any;
    console.log(metadata);

    const fileStream = fs.createReadStream(filePath);

    // Read IV from the beginning of the file
    const ivChunk = await new Promise<Buffer>((resolve) => {
      fileStream.once("readable", () => {
        resolve(fileStream.read(16));
      });
    });

    if (!ivChunk || ivChunk.length !== 16) {
      throw new Error("Invalid file format");
    }

    const decipher = crypto.createDecipheriv(this.algorithm, this.encryptionKey, ivChunk);

    res.setHeader("Content-Type", mime.lookup(metadata.originalName) || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${metadata.originalName}"`);

    await pipeline(fileStream, decipher, res);
  }
}

export default StreamingFileCryptoModule;
