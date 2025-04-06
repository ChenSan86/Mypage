/***** landmarks表 *****/
/*索引范围	对应部位	            
        0	       手掌基部（手腕中心）	
        1-4	     拇指（从基部到指尖）	4=拇指尖
        5-8	     食指	8=食指尖
        9-12	  中指	12=中指尖
        13-16	  无名指	16=无名指尖
        17-20	  小指	20=小指尖
/***** 卡尔曼滤波器类（二维） *****/
class KalmanFilter2D {
  constructor({ R = 0.01, Q = 3, A = 1, B = 0, C = 1 } = {}) {
    this.R = R; // 过程噪声协方差
    this.Q = Q; // 测量噪声协方差
    this.A = A; // 状态转移系数
    this.B = B; // 控制矩阵
    this.C = C; // 测量矩阵
    this.x = 0; // 初始状态估计
    this.P = 1; // 初始估计协方差
  }
  filter(z, u = 0) {
    // 预测
    const x_pred = this.A * this.x + this.B * u;
    const P_pred = this.A * this.P * this.A + this.R;
    // 卡尔曼增益
    const K = (P_pred * this.C) / (this.C * P_pred * this.C + this.Q);
    // 更新状态
    this.x = x_pred + K * (z - this.C * x_pred);
    this.P = (1 - K * this.C) * P_pred;
    return this.x;
  }
  setState(x, P) {
    this.x = x;
    this.P = P;
  }
}

// 全局变量声明
const video = document.getElementById("videoElement");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const virtualMouse = document.getElementById("virtualMouse");

let model;
const videoWidth = 640,
  videoHeight = 480;
const smoothingFactor = 0.1; // 用于相对位移平滑（若结合卡尔曼滤波，可适当调整）
const margin = 50; // 映射时预留边缘

// 归一化手势判断参数
const OPEN_FINGER_THRESHOLD_RATIO = 0.6; // 指尖到腕部距离大于此比例视为张开
const FIST_SPREAD_THRESHOLD_RATIO = 0.4; // 指尖横向和纵向范围小于此比例视为握拳

// 状态机：状态取值 "none", "click", "v", "open"
let currentGestureState = "none";
// 为状态平滑记录连续相同状态的计数
let stateCount = 0;
const STATE_STABLE_THRESHOLD = 1; // 连续 3 帧状态一致后认为稳定

// trackingMode：true 时鼠标根据手部位移更新，false 时保持当前位置
let trackingMode = true;

// 用于相对运动更新：记录上一帧手部位置（视频坐标，经过镜像转换）
let previousHandPos = null;
// 虚拟鼠标当前位置（窗口坐标），初始设为屏幕中心
let mousePos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };

// 创建卡尔曼滤波器实例（分别用于 x 和 y）
const kalmanFilterX = new KalmanFilter2D();
const kalmanFilterY = new KalmanFilter2D();
// 初始化滤波器状态为初始鼠标位置
kalmanFilterX.setState(mousePos.x, 1);
kalmanFilterY.setState(mousePos.y, 1);

// 初始化摄像头
async function setupCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
    });
    video.srcObject = stream;
    return new Promise(
      (resolve) => (video.onloadedmetadata = () => resolve(video))
    );
  } catch (err) {
    console.error("摄像头访问失败:", err);
  }
}

// 加载 Handpose 模型
async function loadModel() {
  model = await handpose.load();
  console.log("手势模型加载完成");
}

// 计算欧几里得距离
function getDistance(p1, p2) {
  return Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
}

// 计算手部尺寸：采用腕部（索引0）到中指尖（索引12）的距离
function getHandSize(landmarks) {
  return getDistance(landmarks[0], landmarks[12]);
}

// 判断拇指与食指是否接触，归一化判断：阈值为 handSize 的 0.3
function isTouching(thumbTip, indexTip, handSize) {
  const threshold = 0.3 * handSize;
  return getDistance(thumbTip, indexTip) < threshold;
}

// 判断点击手势：要求拇指与食指接触，同时中指（12）、无名指（16）、小指（20）与腕部距离大于 0.8×handSize
function isClickGesture(landmarks, handSize) {
  if (!isTouching(landmarks[4], landmarks[8], handSize)) return false;
  const wrist = landmarks[0];
  if (
    getDistance(landmarks[12], wrist) <
    OPEN_FINGER_THRESHOLD_RATIO * handSize
  )
    return false;
  if (
    getDistance(landmarks[16], wrist) <
    OPEN_FINGER_THRESHOLD_RATIO * handSize
  )
    return false;
  if (
    getDistance(landmarks[20], wrist) <
    OPEN_FINGER_THRESHOLD_RATIO * handSize
  )
    return false;
  return true;
}

// 判断 V 手势：定义为食指和中指延伸，而无名指和小指收拢
function isVGesture(landmarks, handSize) {
  const wrist = landmarks[0];
  const indexExtended =
    getDistance(landmarks[8], wrist) > OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const middleExtended =
    getDistance(landmarks[12], wrist) > OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const ringExtended =
    getDistance(landmarks[16], wrist) > OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const pinkyExtended =
    getDistance(landmarks[20], wrist) > OPEN_FINGER_THRESHOLD_RATIO * handSize;
  return indexExtended && middleExtended && !ringExtended && !pinkyExtended;
}

// 判断全开手：所有手指均延伸
function isOpenHand(landmarks, handSize) {
  const wrist = landmarks[0];
  const indexExtended =
    getDistance(landmarks[8], wrist) > OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const middleExtended =
    getDistance(landmarks[12], wrist) > OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const ringExtended =
    getDistance(landmarks[16], wrist) > OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const pinkyExtended =
    getDistance(landmarks[20], wrist) > OPEN_FINGER_THRESHOLD_RATIO * handSize;
  return indexExtended && middleExtended && ringExtended && pinkyExtended;
}
// 判断点指手势 —— 仅索引指尖延伸，其它手指折叠
function isPointGesture(landmarks, handSize) {
  const wrist = landmarks[0];
  const indexExtended =
    getDistance(landmarks[8], wrist) > OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const middleFolded =
    getDistance(landmarks[12], wrist) < OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const ringFolded =
    getDistance(landmarks[16], wrist) < OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const pinkyFolded =
    getDistance(landmarks[20], wrist) < OPEN_FINGER_THRESHOLD_RATIO * handSize;
  return indexExtended && middleFolded && ringFolded && pinkyFolded;
}
// 判断手势 拇指向上 —— 仅拇指延伸，其它手指折叠
function isThumbsUpGesture(landmarks, handSize) {
  const wrist = landmarks[0];
  const thumbExtended =
    getDistance(landmarks[4], wrist) > OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const indexFolded =
    getDistance(landmarks[8], wrist) < OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const middleFolded =
    getDistance(landmarks[12], wrist) < OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const ringFolded =
    getDistance(landmarks[16], wrist) < OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const pinkyFolded =
    getDistance(landmarks[20], wrist) < OPEN_FINGER_THRESHOLD_RATIO * handSize;
  return (
    thumbExtended && indexFolded && middleFolded && ringFolded && pinkyFolded
  );
}
// 判断Rock 手势 —— 食指和小指延伸，其它手指折叠
function isRockGesture(landmarks, handSize) {
  const wrist = landmarks[0];
  const indexExtended =
    getDistance(landmarks[8], wrist) > OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const pinkyExtended =
    getDistance(landmarks[20], wrist) > OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const middleFolded =
    getDistance(landmarks[12], wrist) < OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const ringFolded =
    getDistance(landmarks[16], wrist) < OPEN_FINGER_THRESHOLD_RATIO * handSize;
  return indexExtended && pinkyExtended && middleFolded && ringFolded;
}
// 判断和平手势（Peace Gesture）：食指和中指延伸，其它手指折叠
function isPeaceGesture(landmarks, handSize) {
  const wrist = landmarks[0];
  const indexExtended =
    getDistance(landmarks[8], wrist) > OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const middleExtended =
    getDistance(landmarks[12], wrist) > OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const ringFolded =
    getDistance(landmarks[16], wrist) < OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const pinkyFolded =
    getDistance(landmarks[20], wrist) < OPEN_FINGER_THRESHOLD_RATIO * handSize;
  return indexExtended && middleExtended && ringFolded && pinkyFolded;
}
// 判断 OK 手势：拇指与食指接触形成一个圆圈，同时中指、无名指、小指延伸
function isOKGesture(landmarks, handSize) {
  const wrist = landmarks[0];
  // 拇指和食指接触（小于 0.3×handSize）
  const thumbIndexTouch =
    getDistance(landmarks[4], landmarks[8]) < 0.3 * handSize;
  // 其它手指延伸
  const middleExtended =
    getDistance(landmarks[12], wrist) > OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const ringExtended =
    getDistance(landmarks[16], wrist) > OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const pinkyExtended =
    getDistance(landmarks[20], wrist) > OPEN_FINGER_THRESHOLD_RATIO * handSize;
  return thumbIndexTouch && middleExtended && ringExtended && pinkyExtended;
}
// 判断枪击手势（Gun Gesture）：拇指和食指延伸，其它手指折叠
function isGunGesture(landmarks, handSize) {
  const wrist = landmarks[0];
  const indexExtended =
    getDistance(landmarks[8], wrist) > OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const thumbExtended =
    getDistance(landmarks[4], wrist) > OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const middleFolded =
    getDistance(landmarks[12], wrist) < OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const ringFolded =
    getDistance(landmarks[16], wrist) < OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const pinkyFolded =
    getDistance(landmarks[20], wrist) < OPEN_FINGER_THRESHOLD_RATIO * handSize;
  return (
    indexExtended && thumbExtended && middleFolded && ringFolded && pinkyFolded
  );
}
// 判断沙卡手势（Shaka Gesture）：拇指和小指延伸，其它手指折叠
function isShakaGesture(landmarks, handSize) {
  const wrist = landmarks[0];
  const thumbExtended =
    getDistance(landmarks[4], wrist) > OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const pinkyExtended =
    getDistance(landmarks[20], wrist) > OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const indexFolded =
    getDistance(landmarks[8], wrist) < OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const middleFolded =
    getDistance(landmarks[12], wrist) < OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const ringFolded =
    getDistance(landmarks[16], wrist) < OPEN_FINGER_THRESHOLD_RATIO * handSize;
  return (
    thumbExtended && pinkyExtended && indexFolded && middleFolded && ringFolded
  );
}
// 判断电话手势（Phone Gesture）：拇指和小指延伸，其它手指折叠（类似打电话的姿势）
function isPhoneGesture(landmarks, handSize) {
  const wrist = landmarks[0];
  const thumbExtended =
    getDistance(landmarks[4], wrist) > OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const pinkyExtended =
    getDistance(landmarks[20], wrist) > OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const indexFolded =
    getDistance(landmarks[8], wrist) < OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const middleFolded =
    getDistance(landmarks[12], wrist) < OPEN_FINGER_THRESHOLD_RATIO * handSize;
  const ringFolded =
    getDistance(landmarks[16], wrist) < OPEN_FINGER_THRESHOLD_RATIO * handSize;
  return (
    thumbExtended && pinkyExtended && indexFolded && middleFolded && ringFolded
  );
}
//判断仅中指延伸手势（Middle Only Gesture）当只有中指延伸（距离腕部大于 0.8×handSize），而拇指、食指、无名指和小指均处于折叠状态（距离腕部小于 0.8×handSize），可认为是“仅中指”手势。
function isMiddleOnlyGesture(landmarks, handSize) {
  const wrist = landmarks[0];
  const middleExtended = getDistance(landmarks[12], wrist) > 0.8 * handSize;
  const thumbFolded = getDistance(landmarks[4], wrist) < 0.8 * handSize;
  const indexFolded = getDistance(landmarks[8], wrist) < 0.8 * handSize;
  const ringFolded = getDistance(landmarks[16], wrist) < 0.8 * handSize;
  const pinkyFolded = getDistance(landmarks[20], wrist) < 0.8 * handSize;
  return (
    middleExtended && thumbFolded && indexFolded && ringFolded && pinkyFolded
  );
}

// 对坐标进行镜像转换（仅 x 坐标翻转）
function transformCoordinates(point) {
  return { x: videoWidth - point[0], y: point[1] };
}

// 将视频内部坐标映射到窗口，并加入边缘预留
function mapToWindow(pos) {
  return {
    x: margin + (pos.x / videoWidth) * (window.innerWidth - 2 * margin),
    y: margin + (pos.y / videoHeight) * (window.innerHeight - 2 * margin),
  };
}

// 辅助函数：将值限制在[min, max]之间
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// 更新虚拟鼠标位置：将测量值输入卡尔曼滤波器，获得平滑后的估计值，并限制在窗口内
function updateMousePos(measuredX, measuredY) {
  const filteredX = kalmanFilterX.filter(measuredX);
  const filteredY = kalmanFilterY.filter(measuredY);
  mousePos.x = filteredX;
  mousePos.y = filteredY;
  mousePos.x = clamp(mousePos.x, 0, window.innerWidth);
  mousePos.y = clamp(mousePos.y, 0, window.innerHeight);
  virtualMouse.style.transform = `translate(${mousePos.x - 10}px, ${
    mousePos.y - 10
  }px)`;
}

// 平滑更新：直接调用卡尔曼滤波更新
function smoothUpdate(currentHandPos) {
  updateMousePos(currentHandPos.x, currentHandPos.y);
  previousHandPos = currentHandPos;
}

// 事件触发函数：仅保留点击事件
function triggerClick(pos) {
  console.log("点击事件触发，位置：", pos, " 时间：", Date.now());
}

// 更新状态，根据当前检测结果判断手势，并触发相应事件
// mappedPos：映射后的鼠标位置（窗口坐标）
// landmarks：原始手势关键点数组
function updateState(mappedPos, landmarks) {
  const handSize = getHandSize(landmarks);
  const candidateState = isClickGesture(landmarks, handSize)
    ? "click"
    : isVGesture(landmarks, handSize)
    ? "v"
    : isOpenHand(landmarks, handSize)
    ? "open"
    : "none";

  if (candidateState === currentGestureState) {
    stateCount++;
  } else {
    stateCount = 1;
  }
  if (
    stateCount >= STATE_STABLE_THRESHOLD &&
    candidateState !== currentGestureState
  ) {
    currentGestureState = candidateState;
    if (candidateState === "click") {
      triggerClick(mappedPos);
    } else if (candidateState === "v") {
      trackingMode = false;
      virtualMouse.style.backgroundColor = "red";
      console.log("检测到 V 手势：停止跟随");
    } else if (candidateState === "open") {
      if (!trackingMode) {
        trackingMode = true;
        virtualMouse.style.backgroundColor = "blue";
        console.log("检测到全开手：恢复跟随");
        previousHandPos = null;
      }
    }
  }
}

// 控制检测频率：每隔 DETECTION_INTERVAL 帧检测一次
let frameCount = 0;
const DETECTION_INTERVAL = 3;

async function detectHands() {
  frameCount++;
  if (frameCount % DETECTION_INTERVAL !== 0) {
    requestAnimationFrame(detectHands);
    return;
  }
  const predictions = await model.estimateHands(video);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (predictions.length > 0) {
    const landmarks = predictions[0].landmarks;
    // 绘制镜像后的关键点（调试用，可隐藏）
    const mirroredLandmarks = landmarks.map(transformCoordinates);
    mirroredLandmarks.forEach((point) => {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3, 0, 2 * Math.PI);
      ctx.fillStyle = "red";
      ctx.fill();
    });

    // 当前手部位置（视频坐标，经过镜像转换）：取食指跟部（索引5）
    const currentHandPos = transformCoordinates(landmarks[5]);
    if (trackingMode) {
      smoothUpdate(currentHandPos);
    }
    const mappedPos = mapToWindow(currentHandPos);
    updateState(mappedPos, landmarks);
  } else {
    currentGestureState = "none";
  }
  requestAnimationFrame(detectHands);
}

async function main() {
  await setupCamera();
  await loadModel();
  detectHands();
}

main();
