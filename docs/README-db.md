# 🗄️ db.js - Database Configuration

## 📍 Location
`src/config/db.js`

---

## 🎯 What Does This File Do?

This file manages the connection to **MongoDB**. MongoDB is the database where we store information about transcoding jobs (like status, resolution, and S3 paths).

---

## 📝 Code Breakdown

```javascript
import mongoose from 'mongoose';
```
### What is Mongoose?
**Mongoose** is a tool for Node.js that makes it easy to work with MongoDB. It helps us define what our data should look like (Schemas) and provides a clean way to "talk" to the database.

---

```javascript
const connectDB = async () => {
    try {
        const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/video-transcoder';
        await mongoose.connect(mongoURI);
        console.log('MongoDB connected successfully');
    } catch (error) {
        console.error('MongoDB connection error:', error.message);
        process.exit(1);
    }
};
```

### Step-by-Step Explanation:

1. **`async () => { ... }`**: This is an asynchronous function. Connecting to a database takes time, so we "await" the result without blocking the rest of the server.
2. **`const mongoURI = ...`**: We look for the database address in our `.env` file. If it's not there, we use a local one (`mongodb://localhost...`).
3. **`await mongoose.connect(mongoURI)`**: This line actually tells Mongoose to open the connection.
4. **`try...catch`**: If the connection fails (e.g., the database server is down), the `catch` block runs.
5. **`process.exit(1)`**: If we can't connect to the database, our app can't save anything, so we shut it down with an error code (`1`).

---

## 🧠 Key Concepts

### Why do we need a database?
While files are stored in S3, we need a way to track the **state** of those files. For example:
- "Is the video done transcoding?"
- "Where is the 720p version located?"
- "How many jobs are currently in the queue?"

A database allows us to query this information quickly.

### Connecting once
We export this function so that `index.js` can call it exactly **once** when the server starts. Once connected, Mongoose remembers the connection for the rest of the app's life.

---

## 🔗 Related Files

- [index.js](./README-index.md) - Starts the DB connection
- [models/](./README-models.md) - Contains the data structure definitions
