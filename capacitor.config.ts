import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.runtracker.app',
  appName: 'Run Tracker',
  webDir: 'dist',
  plugins: {
    // Plain SQLite; the plugin still bundles SQLCipher but encryption stays off
    CapacitorSQLite: {
      androidIsEncryption: false
    }
  }
};

export default config;
