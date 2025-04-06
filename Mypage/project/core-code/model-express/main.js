// 顶点着色器（使用WGSL编写）
const vertexShader = `
// 定义Uniform缓冲区绑定（0号组，0号绑定点）
@group(0) @binding(0) var<uniform> mvp: mat4x4<f32>;   // MVP矩阵
@group(0) @binding(1) var<uniform> lightPos: vec3<f32>; // 光源位置

// 顶点输入结构（与CPU端顶点数据对应）
struct VertexInput {
    @location(0) position: vec3<f32>,  // 顶点位置（属性位置0）
    @location(1) color: vec3<f32>,      // 顶点颜色（属性位置1）
};

// 顶点输出结构（传递给片段着色器的数据）
struct VertexOutput {
    @builtin(position) position: vec4<f32>, // 必须的裁剪空间位置
    @location(0) color: vec3<f32>,           // 颜色输出（插值到片段）
    @location(1) normal: vec3<f32>,          // 法线输出（当前设置有问题，应使用真实法线）
    @location(2) fragPos: vec3<f32>,         // 片段世界空间位置
};

// 顶点着色器入口函数
@vertex
fn main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.position = mvp * vec4(input.position, 1.0); // 应用MVP变换
    output.color = input.color;           // 直接传递颜色
    output.fragPos = input.position;      // 传递原始位置（假设模型矩阵是单位矩阵）
    output.normal = input.position;       // 这里应该使用真实法线数据，目前有错误
    return output;
}
`;

// 片段着色器（使用WGSL编写）
const fragmentShader = `
@group(0) @binding(1) var<uniform> lightPos: vec3<f32>; // 光源位置

// 片段着色器入口函数
@fragment
fn main(
    @location(0) color: vec3<f32>,    // 接收插值后的颜色
    @location(1) normal: vec3<f32>,    // 接收插值后的法线
    @location(2) fragPos: vec3<f32>,   // 接收片段位置
) -> @location(0) vec4<f32> {         // 输出到颜色附件0
    let lightColor = vec3(1.0);        // 光源颜色（白色）
    let ambient = 0.1 * lightColor;    // 环境光分量（10%强度）
    let lightDir = normalize(lightPos - fragPos); // 计算光照方向
    let diff = max(dot(normalize(normal), lightDir), 0.0); // 漫反射计算
    let diffuse = diff * lightColor;   // 漫反射分量
    return vec4((ambient + diffuse) * color, 1.0); // 合成最终颜色
}
`;

async function init() {
  // 1. 初始化WebGPU基础环境
  const canvas = document.getElementById("webgpu-canvas");
  const adapter = await navigator.gpu.requestAdapter(); // 获取GPU适配器
  const device = await adapter.requestDevice(); // 创建设备
  const context = canvas.getContext("webgpu"); // 获取WebGPU上下文
  const format = navigator.gpu.getPreferredCanvasFormat(); // 获取最佳画布格式
  context.configure({ device, format }); // 配置上下文与设备关联

  // 2. 创建深度纹理（用于深度测试）
  const depthTexture = device.createTexture({
    size: [canvas.width, canvas.height], // 与画布同尺寸
    format: "depth24plus", // 24位深度格式
    usage: GPUTextureUsage.RENDER_ATTACHMENT, // 用作渲染附件
  });

  // 3. 定义立方体顶点数据（包含位置和颜色）
  // 每个顶点包含：位置x,y,z + 颜色r,g,b（共6个浮点数）
  const vertices = new Float32Array([
    // 前表面（红色、绿色、蓝色、黄色）
    -1,
    -1,
    1,
    1,
    0,
    0, // 顶点0
    1,
    -1,
    1,
    0,
    1,
    0, // 顶点1
    1,
    1,
    1,
    0,
    0,
    1, // 顶点2
    -1,
    1,
    1,
    1,
    1,
    0, // 顶点3
    // 后表面（品红、青色、白色、黑色）
    -1,
    -1,
    -1,
    1,
    0,
    1, // 顶点4
    1,
    -1,
    -1,
    0,
    1,
    1, // 顶点5
    1,
    1,
    -1,
    1,
    1,
    1, // 顶点6
    -1,
    1,
    -1,
    0,
    0,
    0, // 顶点7
  ]);

  // 索引数据（定义三角形组成）
  const indices = new Uint16Array([
    0,
    1,
    2,
    0,
    2,
    3, // 前表面
    4,
    5,
    6,
    4,
    6,
    7, // 后表面
    4,
    0,
    3,
    4,
    3,
    7, // 左表面
    1,
    5,
    6,
    1,
    6,
    2, // 右表面
    3,
    2,
    6,
    3,
    6,
    7, // 上表面
    4,
    5,
    1,
    4,
    1,
    0, // 下表面
  ]);

  // 4. 创建GPU缓冲区并上传数据
  const vertexBuffer = device.createBuffer({
    size: vertices.byteLength, // 缓冲区大小（字节）
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, // 用途：顶点数据
  });
  device.queue.writeBuffer(vertexBuffer, 0, vertices); // 上传顶点数据

  const indexBuffer = device.createBuffer({
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, // 用途：索引数据
  });
  device.queue.writeBuffer(indexBuffer, 0, indices); // 上传索引数据

  // 5. 创建渲染管线
  const pipeline = device.createRenderPipeline({
    layout: "auto", // 自动推断布局
    vertex: {
      module: device.createShaderModule({ code: vertexShader }), // 顶点着色器
      entryPoint: "main",
      buffers: [
        {
          arrayStride: 6 * 4, // 每个顶点占6个float32（24字节）
          attributes: [
            { shaderLocation: 0, offset: 0, format: "float32x3" }, // 位置属性
            { shaderLocation: 1, offset: 3 * 4, format: "float32x3" }, // 颜色属性（从第12字节开始）
          ],
        },
      ],
    },
    fragment: {
      module: device.createShaderModule({ code: fragmentShader }), // 片段着色器
      entryPoint: "main",
      targets: [{ format }], // 输出到画布格式
    },
    primitive: { topology: "triangle-list" }, // 三角形列表模式
    depthStencil: {
      // 深度测试配置
      format: "depth24plus",
      depthWriteEnabled: true, // 启用深度写入
      depthCompare: "less", // 深度比较函数（小于时通过）
    },
  });

  // 6. 创建Uniform缓冲区（注意256字节对齐要求）
  const mvpBuffer = device.createBuffer({
    size: 256, // mat4x4<f32> 实际需要64字节，但需要对齐到256
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const lightBuffer = device.createBuffer({
    size: 256, // vec3<f32> 实际需要12字节，填充到16字节对齐
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // 7. 创建绑定组（描述Uniform资源如何绑定）
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0), // 使用管线布局
    entries: [
      { binding: 0, resource: { buffer: mvpBuffer } }, // MVP矩阵绑定到0号
      { binding: 1, resource: { buffer: lightBuffer } }, // 光源位置绑定到1号
    ],
  });

  // 8. 鼠标控制相机旋转逻辑
  let cameraAngle = { x: 0, y: 0 }; // 存储旋转角度
  let isDragging = false; // 拖拽状态标志
  let lastX = 0,
    lastY = 0; // 记录上次鼠标位置

  canvas.addEventListener("mousedown", (e) => {
    isDragging = true;
    lastX = e.clientX; // 记录按下时的鼠标X
    lastY = e.clientY; // 记录按下时的鼠标Y
  });

  canvas.addEventListener("mousemove", (e) => {
    if (isDragging) {
      cameraAngle.x += (e.clientX - lastX) * 0.01; // 计算X轴旋转增量
      cameraAngle.y += (e.clientY - lastY) * 0.01; // 计算Y轴旋转增量
      lastX = e.clientX; // 更新最后鼠标位置
      lastY = e.clientY;
    }
  });

  canvas.addEventListener("mouseup", () => (isDragging = false)); // 结束拖拽

  // 9. 渲染循环
  function render() {
    // 计算模型矩阵（随时间旋转）
    const model = mat4.create();
    mat4.rotateX(model, model, performance.now() / 2000); // X轴旋转（每秒一圈）
    mat4.rotateY(model, model, performance.now() / 2000); // Y轴旋转

    // 计算视图矩阵（相机位置和旋转）
    const view = mat4.create();
    mat4.translate(view, view, [0, 0, -5]); // 将相机后移5单位
    mat4.rotateX(view, view, cameraAngle.y); // 应用鼠标Y轴旋转到X轴
    mat4.rotateY(view, view, cameraAngle.x); // 应用鼠标X轴旋转到Y轴

    // 计算透视投影矩阵
    const projection = mat4.create();
    mat4.perspective(
      projection,
      Math.PI / 3, // 视场角60度
      canvas.width / canvas.height, // 宽高比
      0.1, // 近裁剪面
      100 // 远裁剪面
    );

    // 合并MVP矩阵：Projection * View * Model
    const mvp = mat4.create();
    mat4.multiply(mvp, projection, view);
    mat4.multiply(mvp, mvp, model);

    // 更新Uniform缓冲区数据
    device.queue.writeBuffer(mvpBuffer, 0, new Float32Array(mvp)); // 写入MVP矩阵
    device.queue.writeBuffer(lightBuffer, 0, new Float32Array([2, 2, 2, 0])); // 光源位置（vec3填充为vec4）

    // 构建并提交渲染指令
    const encoder = device.createCommandEncoder(); // 创建命令编码器
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(), // 当前帧纹理视图
          clearValue: [0.1, 0.1, 0.1, 1], // 清除颜色（深灰色）
          loadOp: "clear", // 清除操作
          storeOp: "store", // 存储操作（保留结果）
        },
      ],
      depthStencilAttachment: {
        view: depthTexture.createView(), // 深度附件视图
        depthClearValue: 1.0, // 深度清除值（最大深度）
        depthLoadOp: "clear", // 深度清除操作
        depthStoreOp: "store", // 存储深度结果
      },
    });

    // 设置渲染状态并绘制
    pass.setPipeline(pipeline); // 使用创建好的管线
    pass.setBindGroup(0, bindGroup); // 绑定Uniform资源
    pass.setVertexBuffer(0, vertexBuffer); // 绑定顶点缓冲区
    pass.setIndexBuffer(indexBuffer, "uint16"); // 绑定索引缓冲区
    pass.drawIndexed(indices.length); // 执行绘制（按索引绘制）
    pass.end(); // 结束渲染通道

    device.queue.submit([encoder.finish()]); // 提交命令缓冲区
    requestAnimationFrame(render); // 请求下一帧
  }

  render(); // 启动渲染循环
}

// 启动初始化并捕获错误
init().catch((err) => console.error("初始化失败:", err));
/**[CPU]                      [GPU]
|                           |
| 创建资源(缓冲区、纹理)       |
|-------------------------->|
|                           |
| 编译着色器、创建管线         |
|-------------------------->|
|                           |
| 循环开始                   |
| 更新Uniform数据            |
|-------------------------->|
| 构建命令缓冲区              |
| 提交绘制命令               |
|-------------------------->|
|                           |-- 顶点着色
|                           |-- 图元组装
|                           |-- 光栅化
|                           |-- 片段着色
|                           |-- 深度测试
|                           |-- 写入帧缓冲
|                           |
|<--- 显示交换链纹理 ---------| */