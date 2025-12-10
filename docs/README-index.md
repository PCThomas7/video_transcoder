# 📄 index.js - Application Entry Point

## 📍 Location
`src/index.js`

---

## 🎯 What Does This File Do?

This is the **starting point** of the application. When you run `node src/index.js`, this file:

1. Creates an Express web server
2. Configures middleware (CORS, JSON parsing)
3. Sets up API routes
4. Starts listening for incoming requests

---

## 📝 Code Breakdown

```javascript
import express from 'express'
import cors from 'cors'
import uploadRouter from './routes/upload.js'
```

### What's Happening Here?

| Import | Purpose |
|--------|---------|
| `express` | Web framework to create the server |
| `cors` | Allows requests from other domains (like your frontend) |
| `uploadRouter` | The routes for handling video uploads |

---

```javascript
const app = express()
const port = process.env.PORT || 2000
```

### What's Happening Here?

1. **`app = express()`** - Creates an Express application
2. **`port = process.env.PORT || 2000`** - Uses port from environment variable, or defaults to 2000

> 💡 **Environment Variables**: Values that can be set outside the code. Useful for secrets and configuration.

---

```javascript
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: false }))
```

### Middleware Configuration

| Middleware | What It Does |
|------------|--------------|
| `cors()` | Allows cross-origin requests (frontend on different domain can call this API) |
| `express.json()` | Parses JSON data in request body |
| `express.urlencoded()` | Parses URL-encoded data (like form submissions) |

---

```javascript
app.use('/api/upload', uploadRouter)
```

### Route Mounting

This line says: "Use the `uploadRouter` for any request that starts with `/api/upload`"

**Example:**
- Request to `/api/upload/upload-transcode` → Handled by `uploadRouter`
- Request to `/api/users` → Not handled (no route defined)

---

```javascript
app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`)
})
```

### Starting the Server

- **`app.listen(port, callback)`** - Starts the server on the specified port
- The callback function runs when the server is ready
- Prints a message so you know the server started

---

## 🔄 Visual Flow

```
┌─────────────────────────────────────────────────────────┐
│                    HTTP Request                         │
│              (e.g., POST /api/upload/upload)            │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                 1. CORS Middleware                      │
│          (Check if request is allowed)                  │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│              2. express.json() Middleware               │
│           (Parse JSON body if present)                  │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│           3. express.urlencoded() Middleware            │
│         (Parse form data if present)                    │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│                4. uploadRouter                          │
│    (Handle /api/upload/* routes)                        │
└─────────────────────────────────────────────────────────┘
```

---

## 🧠 Key Concepts

### What is Express?
Express is a minimal web framework for Node.js. It makes it easy to:
- Handle HTTP requests (GET, POST, PUT, DELETE)
- Define routes (URLs)
- Use middleware (functions that process requests)

### What is CORS?
**CORS** = Cross-Origin Resource Sharing

By default, browsers block requests from one domain to another. CORS headers tell the browser "it's okay to call this API from another domain."

**Example:**
- Your frontend is at `http://localhost:3000`
- Your backend is at `http://localhost:2000`
- Without CORS, the browser would block API calls from frontend to backend

### What is Middleware?
Middleware functions have access to:
- The request object (`req`)
- The response object (`res`)
- The next middleware function (`next`)

They can:
- Execute code
- Modify request/response objects
- End the request-response cycle
- Call the next middleware

---

## 🔗 Related Files

This file imports:
- [upload.js](./README-upload-routes.md) - Defines the upload routes
