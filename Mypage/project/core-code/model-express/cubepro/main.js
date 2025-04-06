import {
  createRenderPipeline,
  createVertexBuffer,
  createUniformBuffer,
  loadTextureWithMipmaps,
} from "./utils/webgpu-utils.js";

class CubeRenderer {
  async init() {
    this.canvas = document.getElementById("webgpu-canvas");
    this.device = await this.initWebGPU();
    this.pipeline = await this.createPipeline();
    this.resources = await this.loadResources();
    this.setupRenderLoop();
  }

  async initWebGPU() {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const context = this.canvas.getContext("webgpu");
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format });
    return device;
  }

  async createPipeline() {
    const vertexShader = await fetch("shaders/cube.vert.wgsl").then((r) =>
      r.text()
    );
    const fragmentShader = await fetch("shaders/cube.frag.wgsl").then((r) =>
      r.text()
    );

    return createRenderPipeline(this.device, {
      vertex: {
        code: vertexShader,
        buffers: [
          {
            arrayStride: 48,
            attributes: [
              { shaderLocation: 0, format: "float32x3" }, // Position
              { shaderLocation: 1, format: "float32x2" }, // UV
              { shaderLocation: 2, format: "float32x3" }, // Normal
              { shaderLocation: 3, format: "float32x3" }, // Tangent
            ],
          },
        ],
      },
      fragment: {
        code: fragmentShader,
        targets: [
          { format: this.canvas.getContext("webgpu").getPreferredFormat() },
        ],
      },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    });
  }

  async loadResources() {
    return {
      texture: await loadTextureWithMipmaps(this.device, "textures/base.png"),
      vertexBuffer: createVertexBuffer(
        this.device,
        new Float32Array([
          /* 顶点数据 */
        ])
      ),
      uniformBuffer: createUniformBuffer(this.device, 256),
    };
  }

  setupRenderLoop() {
    const frame = () => {
      this.render();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  render() {
    const commandEncoder = this.device.createCommandEncoder();
    const pass = commandEncoder.beginRenderPass({
      /*...*/
    });
    pass.setPipeline(this.pipeline);
    pass.setVertexBuffer(0, this.resources.vertexBuffer);
    pass.draw(36); // 立方体顶点数
    pass.end();
    this.device.queue.submit([commandEncoder.finish()]);
  }
}

const renderer = new CubeRenderer();
renderer.init().catch(console.error);
