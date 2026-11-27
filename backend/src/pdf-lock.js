import crypto from "node:crypto";
import { PDFDocument, EncryptedPDFError } from "@cantoo/pdf-lib";

/*
 * Every personal file that leaves Wohlig One is a PDF locked with the viewer's document password (doc-password.js):
 *   - an uploaded PDF is re-saved with the password;
 *   - an uploaded photo (JPG or PNG) is put on an A4 page of a new PDF with the password;
 *   - a PDF that is already password-protected by whoever uploaded it is sent as it is (it cannot be opened to lock it again).
 * It opens with that password (AES-256); it can be printed, not changed or copied from. Generated PDFs (payslips, Form 124) are
 * drawn first and locked here the same way.
 */
const A4 = [595.28, 841.89], MARGIN = 36;
const PERMISSIONS = { printing: "highResolution", modifying: false, copying: false, annotating: false, fillingForms: false, contentAccessibility: true, documentAssembly: false };

/** A PDF of `buf` (a PDF, JPG or PNG, as `mime` says) locked with `password`. Returns a Buffer. */
export async function lockedPdfOf(buf, mime, password, { title = "Document" } = {}) {
  if (!password) throw new Error("A document password is needed to lock the file.");
  let doc;
  if (mime === "application/pdf") {
    try { doc = await PDFDocument.load(buf, { updateMetadata: false }); }
    catch (e) { if (e instanceof EncryptedPDFError || /encrypt/i.test(String(e && e.message))) return buf; throw e; }
  } else if (mime === "image/jpeg" || mime === "image/png") {
    doc = await PDFDocument.create();
    const img = mime === "image/png" ? await doc.embedPng(buf) : await doc.embedJpg(buf);
    const page = doc.addPage(A4);
    const s = Math.min((A4[0] - 2 * MARGIN) / img.width, (A4[1] - 2 * MARGIN) / img.height, 1);
    const w = img.width * s, h = img.height * s;
    page.drawImage(img, { x: (A4[0] - w) / 2, y: A4[1] - MARGIN - h, width: w, height: h });
    doc.setTitle(title);
  } else {
    throw new Error(`Cannot make a PDF of ${mime}.`);
  }
  doc.encrypt({ userPassword: password, ownerPassword: crypto.randomBytes(24).toString("base64"), permissions: PERMISSIONS });
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/** "Passport.jpg" -> "Passport.pdf", for the file name of the locked copy. */
export const pdfName = (name) => `${String(name || "document").replace(/\.[A-Za-z0-9]{1,5}$/, "") || "document"}.pdf`;
