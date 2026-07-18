import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-7xl">
        🎧
      </motion.div>
      <h1 className="text-4xl font-black">404</h1>
      <p className="text-ink-muted">This track skipped. The page you're looking for doesn't exist.</p>
      <Link to="/" className="rounded-full bg-accent px-6 py-2.5 font-semibold text-white">
        Back home
      </Link>
    </div>
  );
}
