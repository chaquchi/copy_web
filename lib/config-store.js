const fs = require('fs');
const path = require('path');

class ConfigStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.value = { collectors: {} };
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        this.value = { collectors: parsed.collectors || {} };
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn(`读取配置失败：${error.message}`);
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.value, null, 2));
    fs.renameSync(temporary, this.filePath);
  }

  collectors() {
    return { ...this.value.collectors };
  }

  setCollector(source, config) {
    this.value.collectors[source] = config;
    this.save();
  }

  removeCollector(source) {
    delete this.value.collectors[source];
    this.save();
  }
}

module.exports = { ConfigStore };
