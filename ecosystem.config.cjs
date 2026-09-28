// Configuración PM2 para ninesys-mcp-server.
// Uso: pm2 start ecosystem.config.cjs   (tras `npm run build`)
module.exports = {
  apps: [
    {
      name: "ninesys-mcp-server",
      script: "dist/index.js",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
      },
      max_memory_restart: "300M",
      out_file: "logs/out.log",
      error_file: "logs/error.log",
      merge_logs: true,
      time: true,
    },
  ],
};
