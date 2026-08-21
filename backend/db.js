import dns from 'dns';
import mongoose from 'mongoose';

// The mongodb+srv:// scheme needs working SRV/TXT DNS lookups. Some local
// networks/routers advertise a resolver that can't answer those (or times
// out entirely) - pointing Node's own resolver at a public DNS server works
// around that without touching OS-level network settings.
dns.setServers(['8.8.8.8', '1.1.1.1']);

let connectPromise = null;

export function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.warn('MONGO_URI is not set - auth, projects, jobs and billing routes will fail until it is configured in backend/.env.');
    return null;
  }
  if (!connectPromise) {
    connectPromise = mongoose.connect(uri)
      .then(() => {
        console.log('Connected to MongoDB');
      })
      .catch((err) => {
        console.error('MongoDB connection failed:', err.message);
        connectPromise = null;
      });
  }
  return connectPromise;
}

export function isDBConnected() {
  return mongoose.connection.readyState === 1;
}
