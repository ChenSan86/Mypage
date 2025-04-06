//后端服务器,serverpro.js 基于nodejs
const express = require('express');
const cors = require('cors');
const Redis = require('ioredis');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
const winston = require('winston');
const net = require('net');

// ================= 全局变量声明 =================
let server;  // 服务器实例

// ================= 日志配置 =================
const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const logger = winston.createLogger({
  transports: [
    new winston.transports.File({
      filename: path.join(logDir, 'key-manager.log'),
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.json()
      )
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// ================= Redis 配置 =================
const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: 6379,
  retryStrategy: (times) => Math.min(times * 500, 5000),
  reconnectOnError: (err) => {
    logger.error('Redis连接错误', { error: err.message });
    return true;
  },
  enableOfflineQueue: true, // 启用离线队列缓冲
  maxRetriesPerRequest: 5,  // 增加重试次数
  retryDelay: 3000,
});

// Redis 连接监控
redis.on('connect', () => logger.info('✅ Redis 连接成功'));
redis.on('error', (err) => logger.error('❌ Redis连接失败', { error: err }));

// ================= Express 应用配置 =================
const app = express();

// CORS 配置
const corsOptions = {
  origin: [
    'http://localhost:5500',    // Live Server 默认端口
    'http://127.0.0.1:5500',    // 本地 IP 访问
    'http://localhost:3000'     // 前端独立部署时使用
  ],
  methods: 'GET,POST,PUT,DELETE,OPTIONS',
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 204
};
app.use(cors(corsOptions));
app.use(express.json());

// 请求日志中间件
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, { ip: req.ip });
  next();
});

// ================= 核心功能 =================
// 初始化密钥池
const initializeKeyPool = async () => {
  try {
    logger.info('🔍 检查密钥池...');
    if (redis.status !== 'ready') {
      await new Promise((resolve) => {
        redis.once('connect', resolve);
      });
    }
    const exists = await redis.exists('key_pool');
    
    if (!exists) {
      logger.info('⚙️ 正在初始化密钥池');
      await redis.hmset('key_pool', 
        'sk-DRo2524SJhYokrQnCZmqeUNgC8FTAZynuyaDQFlXuOcDgmg4', JSON.stringify({ max: 100, used: 0 }),
        'sk-zCMiiWdvfsQg5zneer1W4uGT8XEXrVXo7aptN438fIAtfXWV', JSON.stringify({ max: 100, used: 0 }),
        'sk-cGZ3qcjwsXXpI7adfXbeOQlyzGmHi7O1SYpMcCrEQpCoi9G1', JSON.stringify({ max: 100, used: 0 })
      );
      logger.info('✅ 密钥池初始化完成');
    }
  } catch (err) {
    logger.error('❌ 初始化失败', { error: err.stack });
    process.exit(1);
  }
};

// 端口检查函数
const checkPortAvailable = (port) => {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.close(() => resolve(true));
      })
      .listen(port);
  });
};

// ================= 接口定义 =================
app.post('/api-keys/allocate', async (req, res) => {
  try {
    logger.info('🔑 收到密钥分配请求');
    const [keyPoolResult] = await redis.pipeline().hgetall('key_pool').exec();
    const keyPool = keyPoolResult[1];

    const availableEntry = Object.entries(keyPool).find(
      ([, data]) => JSON.parse(data).used < JSON.parse(data).max
    );

    if (!availableEntry) {
      logger.warn('⚠️ 无可用密钥');
      return res.status(503).json({ error: '无可用密钥' });
    }

    const [key, keyData] = availableEntry;
    const parsedData = JSON.parse(keyData);
    const updatedData = { ...parsedData, used: parsedData.used + 1 };

    await redis.pipeline()
      .hset('key_pool', key, JSON.stringify(updatedData))
      .zadd('allocations', Date.now(), JSON.stringify({ key, client: req.ip }))
      .exec();

    logger.info(`✅ 已分配密钥: ${key}`);
    res.json({ key, expires_in: 3600 });
  } catch (error) {
    logger.error('❗ 分配错误', { error: error.stack });
    res.status(500).json({ error: '服务器内部错误' });
  }
});

app.post('/release', async (req, res) => {
  try {
    const { key } = req.body;
    logger.info(`🔒 收到释放请求: ${key}`);
    
    const keyData = await redis.hget('key_pool', key);
    if (!keyData) {
      logger.warn(`⚠️ 密钥不存在: ${key}`);
      return res.status(404).json({ error: '密钥不存在' });
    }

    const parsedData = JSON.parse(keyData);
    if (parsedData.used <= 0) {
      logger.warn(`⚠️ 密钥未在使用: ${key}`);
      return res.status(400).json({ error: '密钥未在使用中' });
    }

    await redis.pipeline()
      .hincrby('key_pool', key, 'used', -1)
      .zrem('allocations', JSON.stringify({ key }))
      .exec();

    logger.info(`✅ 已释放密钥: ${key}`);
    res.json({ key, remaining: parsedData.max - parsedData.used + 1 });
  } catch (error) {
    logger.error('❗ 释放错误', { error: error.stack });
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// ================= 定时任务 =================
cron.schedule('0 * * * *', async () => {
  try {
    logger.info('⏳ 执行自动回收任务');
    const cutoff = Date.now() - 3600 * 1000;
    const expiredKeys = await redis.zrangebyscore('allocations', '-inf', cutoff);
    
    for (const keyData of expiredKeys) {
      const { key } = JSON.parse(keyData);
      await redis.pipeline()
        .hincrby('key_pool', key, 'used', -1)
        .zrem('allocations', keyData)
        .exec();
      logger.info(`✅ 已回收密钥: ${key}`);
    }
  } catch (error) {
    logger.error('❗ 自动回收失败', { error: error.stack });
  }
});

// ================= 进程管理 =================
process.on('uncaughtException', (err) => {
  logger.error('‼️ 未捕获异常', { error: err.stack });
  process.exit(1);
});

process.on('SIGINT', async () => {
  logger.info('🛑 正在关闭服务...');
  try {
    await redis.quit();
    if (server) {
      server.close(() => {
        logger.info('✅ 服务已正常关闭');
        process.exit(0);
      });
    }
  } catch (err) {
    logger.error('‼️ 关闭错误', { error: err.stack });
    process.exit(1);
  }
});

// ================= 服务启动 =================
(async () => {
  try {
    // 初始化密钥池
    await initializeKeyPool();
    
    // 端口检查
    const port = 3000;
    if (!await checkPortAvailable(port)) {
      logger.error(`❌ 端口 ${port} 被占用`);
      process.exit(1);
    }

    // 启动服务
    server = app.listen(port, () => {
      logger.info(`🚀 服务已启动: http://localhost:${port}`);
      console.log(`
███████╗███████╗██████╗ ██╗   ██╗██╗ ██████╗ 
██╔════╝██╔════╝██╔══██╗██║   ██║██║██╔════╝ 
█████╗  █████╗  ██████╔╝██║   ██║██║██║      
██╔══╝  ██╔══╝  ██╔══██╗╚██╗ ██╔╝██║██║      
███████╗███████╗██║  ██║ ╚████╔╝ ██║╚██████╗ 
╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚═╝ ╚═════╝                                            
      `);
    });
  } catch (err) {
    logger.error('‼️ 服务启动失败', { error: err.stack });
    process.exit(1);
  }
})();