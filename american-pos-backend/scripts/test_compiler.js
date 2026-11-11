const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';

const csSource = `
using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;

class StubTest {
    static int Main() {
        string exePath = Assembly.GetExecutingAssembly().Location;
        using (FileStream fs = new FileStream(exePath, FileMode.Open, FileAccess.Read, FileShare.Read)) {
            fs.Seek(-8, SeekOrigin.End);
            byte[] lenBytes = new byte[8];
            fs.Read(lenBytes, 0, 8);
            long payloadLen = BitConverter.ToInt64(lenBytes, 0);

            long payloadStart = fs.Length - 8 - payloadLen;
            fs.Seek(payloadStart, SeekOrigin.Begin);

            using (ZipArchive archive = new ZipArchive(fs, ZipArchiveMode.Read, true)) {
                Console.WriteLine("Entries in embedded payload: " + archive.Entries.Count);
                foreach (var entry in archive.Entries) {
                    Console.WriteLine("  Found entry: " + entry.FullName);
                }
            }
        }
        return 0;
    }
}
`;

fs.writeFileSync('temp_stub.cs', csSource);
execSync(`"${csc}" /target:exe /reference:System.IO.Compression.FileSystem.dll /reference:System.IO.Compression.dll /out:temp_stub.exe temp_stub.cs`);
console.log('Stub compiled successfully!');

// Clean up
if (fs.existsSync('temp_stub.cs')) fs.unlinkSync('temp_stub.cs');
if (fs.existsSync('temp_stub.exe')) fs.unlinkSync('temp_stub.exe');
