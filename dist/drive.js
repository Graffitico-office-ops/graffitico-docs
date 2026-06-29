"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadPdf = uploadPdf;
/**
 * drive.ts — Google Drive upload client using OAuth2 refresh token.
 * Organizes PDFs into: GraffitiCo / {Year} / {Month} / {OrgName} /
 */
const googleapis_1 = require("googleapis");
const stream_1 = require("stream");
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const ROOT_FOLDER = process.env.GOOGLE_DRIVE_FOLDER_ID;
function getAuth() {
    const oauth2 = new googleapis_1.google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
    oauth2.setCredentials({ refresh_token: REFRESH_TOKEN });
    return oauth2;
}
function getDrive() {
    return googleapis_1.google.drive({ version: 'v3', auth: getAuth() });
}
// ─── Find or create a subfolder by name under a parent ───────────────────────
async function getOrCreateFolder(name, parentId) {
    const drive = getDrive();
    // Search for existing folder
    const res = await drive.files.list({
        q: `name='${name.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
        fields: 'files(id, name)',
        spaces: 'drive',
    });
    if (res.data.files && res.data.files.length > 0) {
        return res.data.files[0].id;
    }
    // Create it
    const folder = await drive.files.create({
        requestBody: {
            name,
            mimeType: 'application/vnd.google-apps.folder',
            parents: [parentId],
        },
        fields: 'id',
    });
    return folder.data.id;
}
/**
 * Upload a PDF to Google Drive.
 * Folder structure: ROOT / YYYY / Mon YYYY / OrgName / filename.pdf
 *
 * @returns The Google Drive file URL
 */
async function uploadPdf(pdfBuffer, fileName, orgName, issueDate) {
    const drive = getDrive();
    const date = new Date(issueDate);
    const year = String(date.getFullYear());
    const month = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); // "Jun 2026"
    const org = orgName.replace(/[/\\?%*:|"<>]/g, '-').trim(); // sanitize for folder name
    // Build nested folder path
    const yearFolder = await getOrCreateFolder(year, ROOT_FOLDER);
    const monthFolder = await getOrCreateFolder(month, yearFolder);
    const orgFolder = await getOrCreateFolder(org, monthFolder);
    // Upload file
    const stream = stream_1.Readable.from(pdfBuffer);
    const res = await drive.files.create({
        requestBody: {
            name: fileName,
            parents: [orgFolder],
        },
        media: {
            mimeType: 'application/pdf',
            body: stream,
        },
        fields: 'id, webViewLink',
    });
    const fileId = res.data.id;
    const viewUrl = res.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`;
    // Make it readable by anyone in the org with the link
    await drive.permissions.create({
        fileId,
        requestBody: { role: 'reader', type: 'domain', domain: 'graffitico.com' },
    }).catch(() => {
        // Fall back to "anyone with link" if domain sharing fails
        return drive.permissions.create({
            fileId,
            requestBody: { role: 'reader', type: 'anyone' },
        });
    });
    console.log(`  ☁️  Uploaded to Drive: ${viewUrl}`);
    return viewUrl;
}
