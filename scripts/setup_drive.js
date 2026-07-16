const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

// Auth setup
const KEY_PATH = path.join(__dirname, '..', 'serviceAccountKey.json');
const SCOPES = ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive'];

const auth = new google.auth.GoogleAuth({
    keyFile: KEY_PATH,
    scopes: SCOPES,
});

const drive = google.drive({ version: 'v3', auth });

async function setupBackupFolder() {
    try {
        console.log('--- GOOGLE DRIVE RESCUE SETUP ---');
        
        // 1. Create Folder
        const folderMetadata = {
            name: 'Respaldo American POS (Automático)',
            mimeType: 'application/vnd.google-apps.folder',
        };

        const folder = await drive.files.create({
            resource: folderMetadata,
            fields: 'id',
        });

        const folderId = folder.data.id;
        console.log(`✅ Folder created successfully! ID: ${folderId}`);

        // 2. Share with user
        const userEmail = 'mrivero105@gmail.com';
        await drive.permissions.create({
            fileId: folderId,
            requestBody: {
                role: 'editor',
                type: 'user',
                emailAddress: userEmail,
            },
        });

        console.log(`✅ Shared with ${userEmail} as Editor.`);
        console.log('\n--- SETUP COMPLETE ---');
        console.log(`Folder ID for your .env or config: ${folderId}`);
        console.log(`Link: https://drive.google.com/drive/folders/${folderId}`);
        
        return folderId;
    } catch (error) {
        console.error('❌ Failed to setup drive folder:', error.message);
        if (error.response) {
            console.error('Details:', error.response.data);
        }
    }
}

setupBackupFolder();
