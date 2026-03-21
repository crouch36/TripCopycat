\# TripCopycat — Project Rules



\## Stack

\- React + Vite, single-page app

\- Main app: src/App.jsx (\~2700 lines)

\- Database: Supabase (Postgres)

\- Hosting: Vercel (project name: tripcopycat)

\- Domain: tripcopycat.com via Porkbun

\- Repo: github.com/crouch36/TripCopycat



\## Deployment Rules — CRITICAL

\- NEVER run `vercel`, `npx vercel`, or any Vercel CLI commands

\- NEVER run `vercel --prod` or `vercel deploy`

\- All deployments happen automatically via git push to GitHub

\- Vercel watches the repo and auto-deploys — no manual deploy needed



\## Development Rules

\- Always read src/App.jsx before making changes

\- All external services (Supabase, Gemini API, Porkbun, Google Search Console) are already configured — do not modify credentials or connections

\- End every session with the standard git push only

