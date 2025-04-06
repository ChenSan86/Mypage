class ScientificCalculator {
  constructor() {
    this.current = "0"; // 当前输入值
    this.history = ""; // 计算历史
    this.operator = null; // 当前运算符
    this.memory = null; // 存储中间值
    this.isRadians = true; // 角度模式 (true:弧度, false:角度)
    this.lastAction = null; // 记录上次操作类型

    // DOM元素引用
    this.displayCurrent = document.querySelector(".display .current");
    this.displayHistory = document.querySelector(".display .history");

    this.initEvents();
    this.updateDisplay();
  }

  // 初始化事件监听
  initEvents() {
    document.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        this.handleInput(btn.dataset);
      });
    });
  }

  // 处理输入
  handleInput({ number, action }) {
    try {
      if (number) this.handleNumber(number);
      if (action) this.handleAction(action);
      this.lastAction = action || number;
      this.updateDisplay();
    } catch (error) {
      this.showError(error.message);
    }
  }

  // 处理数字输入
  handleNumber(num) {
    if (this.current === "Error") this.clear();

    // 处理小数点
    if (num === ".") {
      if (!this.current.includes(".")) {
        this.current += num;
      }
      return;
    }

    // 处理常规数字
    if (
      this.current === "0" ||
      this.lastAction === "operator" ||
      this.lastAction === "calculate"
    ) {
      this.current = num;
    } else {
      this.current += num;
    }
  }

  // 处理操作符和函数
  handleAction(action) {
    switch (action) {
      // 基础操作
      case "clear":
        this.clear();
        break;
      case "backspace":
        this.backspace();
        break;
      case "sign":
        this.toggleSign();
        break;
      case "percent":
        this.percent();
        break;
      case "calculate":
        this.calculate();
        break;

      // 科学运算
      case "sin":
      case "cos":
      case "tan":
        this.trigonometric(action);
        break;
      case "log":
        this.logarithm();
        break;
      case "ln":
        this.naturalLog();
        break;
      case "sqrt":
        this.squareRoot();
        break;
      case "square":
        this.power(2);
        break;
      case "cube":
        this.power(3);
        break;
      case "power":
        this.setOperator("power");
        break;
      case "factorial":
        this.factorial();
        break;
      case "reciprocal":
        this.reciprocal();
        break;
      case "exp":
        this.exponential();
        break;
      case "pi":
        this.inputPi();
        break;
      case "mod":
        this.setOperator("mod");
        break;

      // 基础运算符
      default:
        this.setOperator(action);
    }
  }

  // 三角函数计算
  trigonometric(fn) {
    const radians = this.isRadians
      ? parseFloat(this.current)
      : this.degreesToRadians(parseFloat(this.current));

    const result = Math[fn](radians);
    this.history = `${fn}(${this.current}${this.isRadians ? "" : "°"})`;
    this.current = this.validateResult(result);
  }

  // 对数计算
  logarithm() {
    const num = parseFloat(this.current);
    if (num <= 0) throw new Error("Log of non-positive number");
    this.history = `log10(${this.current})`;
    this.current = Math.log10(num).toString();
  }

  // 自然对数
  naturalLog() {
    const num = parseFloat(this.current);
    if (num <= 0) throw new Error("Ln of non-positive number");
    this.history = `ln(${this.current})`;
    this.current = Math.log(num).toString();
  }

  // 幂运算
  power(exponent) {
    const base = parseFloat(this.current);
    this.history = `${base}^${exponent}`;
    this.current = Math.pow(base, exponent).toString();
  }

  // 阶乘计算
  factorial() {
    const n = parseInt(this.current);
    if (n < 0) throw new Error("Negative factorial");
    if (n !== parseFloat(this.current))
      throw new Error("Non-integer factorial");

    this.current = Array.from({ length: n }, (_, i) => i + 1)
      .reduce((acc, val) => acc * val, 1)
      .toString();
    this.history = `${n}! =`;
  }

  // 设置运算符
  setOperator(operator) {
    if (this.operator) this.calculate();

    this.operator = operator;
    this.memory = parseFloat(this.current);
    this.history = `${this.current} ${this.getOperatorSymbol(operator)} `;
    this.current = "0";
  }

  // 执行计算
  calculate() {
    if (!this.operator || this.memory === null) return;

    const current = parseFloat(this.current);
    let result;

    switch (this.operator) {
      case "add":
        result = this.memory + current;
        break;
      case "subtract":
        result = this.memory - current;
        break;
      case "multiply":
        result = this.memory * current;
        break;
      case "divide":
        if (current === 0) throw new Error("Division by zero");
        result = this.memory / current;
        break;
      case "power":
        result = Math.pow(this.memory, current);
        break;
      case "mod":
        result = this.memory % current;
        break;
    }

    this.history += `${this.current} =`;
    this.current = this.validateResult(result);
    this.operator = null;
    this.memory = null;
  }

  // 辅助方法
  degreesToRadians(degrees) {
    return (degrees * Math.PI) / 180;
  }

  validateResult(value) {
    if (isNaN(value)) throw new Error("Invalid calculation");
    if (!isFinite(value)) throw new Error("Result too large");
    return value.toString();
  }

  showError(message) {
    this.current = "Error";
    this.history = message;
    setTimeout(() => this.clear(), 2000);
  }

  // 其他操作实现
  clear() {
    this.current = "0";
    this.history = "";
    this.operator = null;
    this.memory = null;
  }

  backspace() {
    this.current = this.current.slice(0, -1) || "0";
  }

  toggleSign() {
    this.current = (parseFloat(this.current) * -1).toString();
  }

  percent() {
    this.current = (parseFloat(this.current) / 100).toString();
  }

  reciprocal() {
    if (parseFloat(this.current) === 0) throw new Error("Division by zero");
    this.current = (1 / parseFloat(this.current)).toString();
  }

  exponential() {
    this.current = Math.exp(parseFloat(this.current)).toString();
  }

  inputPi() {
    this.current =
      this.current === "0"
        ? Math.PI.toFixed(8)
        : this.current + Math.PI.toFixed(8);
  }

  squareRoot() {
    const num = parseFloat(this.current);
    if (num < 0) throw new Error("Negative square root");
    this.current = Math.sqrt(num).toString();
  }

  getOperatorSymbol(operator) {
    const symbols = {
      add: "+",
      subtract: "-",
      multiply: "×",
      divide: "÷",
      power: "^",
      mod: "%",
    };
    return symbols[operator] || "";
  }

  updateDisplay() {
    this.displayCurrent.textContent = this.current;
    this.displayHistory.textContent = this.history;

    // 自动格式化显示
    const num = parseFloat(this.current);
    if (num > 1e12 || (num < 1e-6 && num !== 0)) {
      this.displayCurrent.textContent = num.toExponential(6);
    }
  }
}

// 初始化计算器
window.addEventListener("DOMContentLoaded", () => {
  new ScientificCalculator();
});
