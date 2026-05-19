# Invest · 策略面板

投资策略监控仪表盘，整合 PE-DCA 信号、宏观五力、持仓跟踪与决策框架。

## GitHub Pages 访问

`https://AMMPNK.github.io/invesment/dashboard/`

## 本地更新

```bash
cd dashboard && python3 data_fetcher.py
```

## 每日自动更新

配置好的 GitHub Actions 每日北京时间 9:00 自动运行更新。

## 依赖

```bash
pip3 install yfinance
```

## 策略逻辑

### PE-DCA 规则

| 市场 | PE偏低 | PE正常 | PE偏高 |
|------|--------|--------|--------|
| 纳指100 | <20→×1.5 | 20-30→×1.0 | >30→×0.5 |
| 沪深300 | <10→×1.5 | 10-18→×1.0 | >18→×0.5 |

### 五大宏观力权重

利率35% | 流动性25% | 汇率20% | 地缘15% | 中国财政5%