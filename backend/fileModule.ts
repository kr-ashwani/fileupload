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
  private iv: Buffer;

  constructor(encryptionKey: string, storagePath: string) {
    // Ensure the key is exactly 32 bytes (256 bits) for AES-256-CBC
    this.encryptionKey = crypto.scryptSync(encryptionKey, "salt", 32);
    this.storagePath = storagePath;
    this.iv = crypto.randomBytes(16);
  }

  async encryptAndSave(
    fileBuffer: Buffer,
    metadata: {
      originalName: string;
      mimeType: string;
      size: number;
      fileId: string;
    }
  ) {
    const cipher = crypto.createCipheriv(this.algorithm, this.encryptionKey, this.iv);
    const filePath = path.join(this.storagePath, metadata.fileId);
    const writeStream = fs.createWriteStream(filePath);
    await pipeline(Readable.from(fileBuffer), cipher, writeStream);
  }

  async decryptAndStream(req: Request, res: Response): Promise<void> {
    const metadata = req.query as any;
    console.log(metadata);
    const filePath = path.join(this.storagePath, metadata.fileId);

    const decipher = crypto.createDecipheriv(this.algorithm, this.encryptionKey, this.iv);
    const fileStream = fs.createReadStream(filePath);

    // Set appropriate headers
    res.setHeader("Content-Type", this.getContentType(metadata.originalName));
    res.setHeader("Content-Disposition", `attachment; filename="${metadata.originalName}"`);

    // Pipe the decrypted stream to the response
    await pipeline(fileStream, decipher, res);
  }

  private getContentType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    return mime.lookup(ext);
  }
}

export default StreamingFileCryptoModule;
