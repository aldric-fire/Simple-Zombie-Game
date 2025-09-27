import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  // Base configuration: set to empty string for relative paths
  // This is helpful if deploying to a non-root path (like GitHub Pages)
  // base: '', 
  
  plugins: [
    // Enables the Fast Refresh feature and handles JSX/TSX transformation
    react(),
  ],

  // Configure PostCSS for Tailwind CSS processing
  css: {
    postcss: {
      plugins: [
        // Load the Tailwind CSS configuration
        require('tailwindcss'),
        // Add vendor prefixes for wider browser compatibility
        require('autoprefixer'),
      ],
    },
  },
  
  // Set up development server options
  server: {
    // Open the browser automatically when the server starts
    open: true,
    // Define the port for the development server
    port: 3000, 
  }
});
