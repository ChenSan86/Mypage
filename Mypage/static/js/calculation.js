class Calculator {
  constructor() {
    this.current = "0";
    this.history = "";
    this.operator = null;
    this.previousValue = null;

    this.displayCurrent = document.querySelector(".display .current");
    this.displayHistory = document.querySelector(".display .history");

    this.initEvents();
  }

  initEvents() {
    document.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => this.handleClick(btn));
    });
  }

  handleClick(btn) {
    const action = btn.dataset.action;
    const number = btn.dataset.number;

    if (number) this.handleNumber(number);
    if (action) this.handleAction(action);
    this.updateDisplay();
  }

  handleNumber(num) {
    if (this.current === "0" && num !== ".") this.current = "";
    if (num === "." && this.current.includes(".")) return;
    this.current += num;
  }

  handleAction(action) {
    switch (action) {
      case "clear":
        this.clear();
        break;
      case "sign":
        this.current = (parseFloat(this.current) * -1).toString();
        break;
      case "percent":
        this.current = (parseFloat(this.current) / 100).toString();
        break;
      case "calculate":
        this.calculate();
        break;
      default:
        this.setOperator(action);
    }
  }

  setOperator(operator) {
    if (this.operator) this.calculate();
    this.operator = operator;
    this.previousValue = this.current;
    this.history = `${this.current} ${this.getOperatorSymbol(operator)} `;
    this.current = "0";
  }

  calculate() {
    if (!this.operator || !this.previousValue) return;

    const prev = parseFloat(this.previousValue);
    const current = parseFloat(this.current);
    let result;

    switch (this.operator) {
      case "add":
        result = prev + current;
        break;
      case "subtract":
        result = prev - current;
        break;
      case "multiply":
        result = prev * current;
        break;
      case "divide":
        result = prev / current;
        break;
    }

    this.history += `${this.current} =`;
    this.current = result.toString();
    this.operator = null;
    this.previousValue = null;
  }

  clear() {
    this.current = "0";
    this.history = "";
    this.operator = null;
    this.previousValue = null;
  }

  getOperatorSymbol(action) {
    const symbols = {
      add: "+",
      subtract: "-",
      multiply: "×",
      divide: "÷",
    };
    return symbols[action] || "";
  }

  updateDisplay() {
    this.displayCurrent.textContent = this.current;
    this.displayHistory.textContent = this.history;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  new Calculator();
});
