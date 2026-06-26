/**
 * auth.ts — Run once: `npm run auth`
 * Opens a browser to authorize Google Drive access, then prints
 * the refresh token to paste into your .env file.
 */
import { google } from 'googleapis';
import * as http from 'http';
import * as url from 'url';
import * as fs from 'fs';
import * as path from 'path';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',  // create/upload files
];

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

async function main() {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',   // force refresh_token to be returned
    scope: SCOPES,
  });

  console.log('\n─────────────────────────────────────────────────────');
  console.log('GraffitiCo Docs — Google Drive Authorization');
  console.log('─────────────────────────────────────────────────────');
  console.log('\n1. Open this URL in your browser:\n');
  console.log(authUrl);
  console.log('\n2. Sign in with the GraffitiCo Google account');
  console.log('3. Approve Drive access');
  console.log('4. You will be redirected to localhost — wait for the token below\n');

  // Spin up a temporary local server to catch the redirect
  const server = http.createServer(async (req, res) => {
    if (!req.url?.startsWith('/oauth2callback')) return;

    const qs = new url.URL(req.url, 'http://localhost:3000').searchParams;
    const code = qs.get('code');

    if (!code) {
      res.end('Error: no code in redirect. Try again.');
      return;
    }

    try {
      const { tokens } = await oauth2Client.getToken(code);

      res.end(`
        <html><body style="font-family:sans-serif;padding:40px;background:#f0f4f0">
          <h2 style="color:#002244">✅ Authorization successful!</h2>
          <p>Close this tab and check your terminal for the refresh token.</p>
        </body></html>
      `);

      console.log('\n─────────────────────────────────────────────────────');
      console.log('✅  SUCCESS — add this to your .env file:');
      console.log('─────────────────────────────────────────────────────');
      console.log(`\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);

      // Also write to a local file for convenience
      const envPath = path.join(__dirname, '..', '.env');
      if (fs.existsSync(envPath)) {
        let env = fs.readFileSync(envPath, 'utf8');
        if (env.includes('GOOGLE_REFRESH_TOKEN=')) {
          env = env.replace(/GOOGLE_REFRESH_TOKEN=.*/, `GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
        } else {
          env += `\nGOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`;
        }
        fs.writeFileSync(envPath, env);
        console.log('Also written to your .env file automatically.\n');
      }

    } catch (err) {
      console.error('Token exchange failed:', err);
      res.end('Error exchanging token. Check terminal.');
    }

    server.close();
  });

  server.listen(3000, () => {
    console.log('Waiting for Google redirect on http://localhost:3000 ...\n');
  });
}

main().catch(console.error);
