# SyncWave Deployment Guide - Vercel + Backend

## Architecture
- **Frontend**: Vite + React → Vercel (static)
- **Backend**: Express + Socket.IO → Railway/Render (recommended) or Vercel Functions

> Note: Socket.IO works best on persistent servers, not serverless. We recommend Railway.io or Render.com

---

## Step 1: Prepare Your Project for Deployment

### 1.1 Create Vercel Configuration
Create `vercel.json` in your project root:

```json
{
  "buildCommand": "npm run build",
  "devCommand": "npm run dev",
  "installCommand": "npm install",
  "framework": "vite",
  "env": {
    "YOUTUBE_API_KEY": "@youtube_api_key",
    "GEMINI_API_KEY": "@gemini_api_key",
    "APP_URL": "@app_url"
  }
}
```

### 1.2 Update Vite Config
Make sure `vite.config.ts` exists with proper build settings:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
```

### 1.3 Create `.env.production` for Frontend
In your project root:

```env
VITE_APP_URL=https://your-vercel-domain.vercel.app
```

---

## Step 2: Deploy Frontend to Vercel

### 2.1 Install Vercel CLI
```bash
npm install -g vercel
```

### 2.2 Login to Vercel
```bash
vercel login
```
(Opens browser, sign in with GitHub/GitLab/Bitbucket)

### 2.3 Deploy Frontend
```bash
vercel --prod
```

You'll be prompted:
- Project name: `syncwave`
- Project root: `.` (current directory)
- Build command: `npm run build`
- Output directory: `dist`
- Development command: `npm run dev`

✅ Frontend is now live! Note the URL (e.g., `https://syncwave.vercel.app`)

---

## Step 3: Deploy Backend to Railway.io (Recommended)

### 3.1 Create Backend Folder Structure
Extract backend to separate location (optional for Railway):

```
/backend
  ├── server.ts
  ├── package.json
  ├── tsconfig.json
  └── .env
```

Or keep current structure, Railway will detect it.

### 3.2 Create Railway Account
1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub
3. Click "New Project"

### 3.3 Connect GitHub Repository
1. Click "Deploy from GitHub"
2. Select `parthkavad54/syncWave` repository
3. Railway auto-detects Node.js project

### 3.4 Configure Environment Variables
In Railway Dashboard → Project Settings → Variables:

```
YOUTUBE_API_KEY=your_api_key_here
GEMINI_API_KEY=your_gemini_key_here
APP_URL=https://your-railway-domain.up.railway.app
NODE_ENV=production
PORT=3000
```

### 3.5 Set Start Command
In Railway → Deployment → Start Command:
```bash
npm run build && npm start
```

Or update `package.json` scripts:
```json
{
  "scripts": {
    "dev": "tsx server.ts",
    "build": "tsc",
    "start": "node dist/server.js"
  }
}
```

### 3.6 Deploy
Click "Deploy" → Railway builds and deploys automatically

✅ Backend is now live! Note the URL (e.g., `https://syncwave-production-xxxx.up.railway.app`)

---

## Step 4: Update Frontend to Use Deployed Backend

### 4.1 Update Socket Connection
In `src/lib/syncEngine.ts`, update the socket URL:

```typescript
const socket = io(
  import.meta.env.PROD 
    ? 'https://your-railway-url.up.railway.app'
    : 'http://localhost:3000',
  {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5,
    transports: ['websocket', 'polling']
  }
);
```

### 4.2 Update API Calls
In `src/App.tsx`, update API endpoints:

```typescript
const API_BASE = import.meta.env.PROD 
  ? 'https://your-railway-url.up.railway.app'
  : 'http://localhost:3000';

// Then use:
fetch(`${API_BASE}/api/youtube/search?q=...`)
```

### 4.3 Update `.env.production`
```env
VITE_API_URL=https://your-railway-url.up.railway.app
```

### 4.4 Rebuild and Redeploy Frontend
```bash
npm run build
vercel --prod
```

---

## Step 5: Configure CORS & WebSocket

### 5.1 CORS Configuration (Already Updated)
Your `server.ts` now has dynamic CORS configuration that automatically:
- Allows `localhost:3000` and `localhost:5173` (development)
- Allows production domains via `APP_URL` environment variable
- Allows Vercel domains via `VERCEL_URL` (automatically set by Vercel)

No further CORS configuration needed! The server will accept:
- Local development connections
- Production frontend (Railway/Vercel)
- Any `APP_URL` you set in environment

### 5.2 Redeploy Backend
When you deploy to Railway, it will automatically use the new CORS settings:

```bash
git add server.ts
git commit -m "Production-ready CORS configuration"
git push origin main
```

Railway auto-redeploys on git push.

---

## Step 6: Set Up Production Environment Variables

### 6.1 Vercel Secrets
```bash
vercel env add YOUTUBE_API_KEY
vercel env add GEMINI_API_KEY
vercel env add VITE_API_URL
```

### 6.2 Railway Secrets
Already done in dashboard.

---

## Step 7: Testing

### 7.1 Test Frontend
1. Go to `https://syncwave.vercel.app`
2. Should load without errors

### 7.2 Test Backend Connection
1. Open DevTools (F12) → Network tab
2. Go to WebSocket tab
3. Create a session → should see WebSocket connection to Railway

### 7.3 Test Full Flow
1. Create a party session
2. Search for music (YouTube, Spotify URL, etc.)
3. Add to queue
4. Play music
5. Check console for errors

---

## Troubleshooting

### Issue: WebSocket Connection Failed
**Solution**: Check CORS in `server.ts`:
```typescript
cors: {
  origin: "https://syncwave.vercel.app",
  credentials: true
}
```

### Issue: YouTube API Not Working
**Solution**: Verify YOUTUBE_API_KEY in Railway dashboard:
```bash
railway env
```

### Issue: 502 Bad Gateway
**Solution**: Check Railway logs:
```bash
railway logs
```

### Issue: CORS Error on API Calls
**Solution**: Update `server.ts`:
```typescript
app.use(cors({
  origin: ["https://syncwave.vercel.app", "http://localhost:3000"],
  credentials: true
}));
```

---

## Monitoring

### Vercel Dashboard
- `https://vercel.com/dashboard`
- Real-time logs: Analytics → Logs

### Railway Dashboard
- `https://railway.app`
- Real-time logs: Project → Deployments → Logs

---

## Custom Domain (Optional)

### Vercel
1. Dashboard → Project → Settings → Domains
2. Add custom domain
3. Update DNS records

### Railway
1. Project → Settings → Custom Domain
2. Point DNS to Railway domain

---

## Deployment Checklist

- [ ] Vercel account created
- [ ] GitHub repository connected
- [ ] Railway account created & connected
- [ ] YouTube API key configured
- [ ] Gemini API key configured
- [ ] Backend URL updated in frontend code
- [ ] CORS configured for production domains
- [ ] Environment variables set in both platforms
- [ ] Frontend deployed to Vercel
- [ ] Backend deployed to Railway
- [ ] WebSocket connection tested
- [ ] API endpoints tested
- [ ] Full user flow tested (search, add, play)

---

## Performance Tips

1. **Enable Caching**
   - Vercel: Settings → Caching
   - Railway: Use Redis for session storage

2. **Monitor Bandwidth**
   - Vercel has generous free tier
   - Railway charges by resource usage

3. **Optimize Images**
   - Compress album artwork before uploading
   - Use WebP format where possible

---

## Next Steps

1. Set up GitHub Actions for CI/CD
2. Add monitoring/alerts
3. Set up error tracking (Sentry)
4. Configure backup for upload storage
5. Add rate limiting for API endpoints
