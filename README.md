# Tumi Medical Institute website

## Run locally

This site needs Node.js 22.13 or later to run its SQLite-backed forms. In PowerShell, from this folder:

```powershell
$env:ADMIN_PASSWORD = 'replace-this-with-a-long-private-password'
npm start
```

Open `http://127.0.0.1:3000` for the website and `http://127.0.0.1:3000/admin.html` to view submissions. The administrator password must be at least 16 characters. Do not commit it or share it.

The database is created automatically at `data/submissions.sqlite`. Set `DB_PATH` to a persistent disk location when deploying. The `data` folder is excluded from Git.

## Form data and administration

- Enquiries are stored with the visitor's name, contact details, topic, message, and submission time.
- Application requests are stored with the applicant's name, contact details, selected programme, education summary, optional message, and submission time. They are requests for follow-up, not final admission decisions.
- Visitors must consent before submitting. After a successful save, they can optionally open WhatsApp and review a prepared message before choosing to send it.
- The admin page requires the server's `ADMIN_PASSWORD`; it can display submissions in pages and delete individual records.
- Records are not deleted automatically. Set and follow the school's data-retention policy, and protect database backups and server access.

Do not collect identity numbers, payment details, health information, or document scans through these forms.

## Deployment

The included server is intended for local use or deployment behind a trusted HTTPS reverse proxy. Do not expose it directly to the public internet over plain HTTP. Use a host that supports Node.js 22.13+ and persistent disk storage; configure a strong `ADMIN_PASSWORD`, a persistent `DB_PATH`, and HTTPS before collecting real personal information. Review the privacy notice and retention practices before launch.

## Tests

```powershell
npm test
```
