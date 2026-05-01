# 🖨️ PrintLab — MACC 3D Print Request Portal

A full-featured 3D print job management system for teachers and lab admins at MACC.

## Features

- **Teacher submission wizard** — 3-step form with STL upload, 3D preview, and auto-fill from URL or filename
- **Live print queue** — admins manage jobs with drag-to-reorder, status updates, and email notifications
- **Filament inventory** — Bambu Lab catalog with stock tracking and shopping list generation
- **Admin insights** — charts and tables broken down by department and teacher
- **Monthly reports** — printable usage summaries
- **Teacher status page** — teachers check their own job status by email
- **Saved templates** — reuse common print requests
- **Build volume warnings** — alerts if STL exceeds Bambu X1C limits

---

## Local Development

```bash
# Install dependencies
npm install

# Start dev server (opens at http://localhost:5173)
npm run dev

# Build for production
npm run build
```

## Deploy to GitHub Pages

### First-time setup

1. Push this repo to GitHub
2. Go to **Settings → Pages**
3. Under **Source**, select **GitHub Actions**
4. Push any commit to `main` — the site builds and deploys automatically

Your site will be live at:
```
https://YOUR-USERNAME.github.io/REPO-NAME/
```

### Automatic deploys

Every push to `main` triggers a new build via the GitHub Actions workflow in `.github/workflows/deploy.yml`. No manual steps needed after setup.

---

## Data Storage

Data is stored in the browser's `localStorage` — meaning each device has its own independent queue. This is fine for a single-admin setup (one person managing the printer from one computer).

For a shared queue visible to multiple admins on different devices, the next step is connecting to [Supabase](https://supabase.com) (free tier) as a shared database. See the project roadmap below.

---

## Roadmap

- [ ] Supabase integration for shared real-time queue
- [ ] Google Drive file storage for STL uploads
- [ ] Google Sign-In via Workspace for Education
- [ ] Bambu printer live status via local LAN API
- [ ] Email sending via EmailJS (no server required)

---

## Tech Stack

- [React 18](https://react.dev)
- [Vite](https://vitejs.dev)
- [Three.js](https://threejs.org) — 3D STL preview
- [Recharts](https://recharts.org) — admin charts
- GitHub Actions + GitHub Pages — CI/CD
