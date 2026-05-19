#!/usr/bin/env python3
import yfinance as yf
import json
import os
from datetime import datetime
import warnings
warnings.filterwarnings('ignore')

DATA_FILE = os.path.join(os.path.dirname(__file__), 'data.json')

def get_price(ticker_obj):
    try:
        info = ticker_obj.info
        return info.get('currentPrice') or info.get('regularMarketPrice') or info.get('previousClose')
    except:
        return None

def fetch_data():
    data = {
        'last_updated': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'last_updated_date': datetime.now().strftime('%Y-%m-%d'),
    }

    # 1. Nasdaq 100 via QQQ
    try:
        qqq = yf.Ticker('QQQ')
        info = qqq.info
        data['nasdaq100'] = {
            'price': get_price(qqq),
            'pe': info.get('trailingPE'),
            'forward_pe': info.get('forwardPE'),
            'pb': info.get('priceToBook'),
        }
    except Exception as e:
        data['nasdaq100'] = {'error': str(e)}

    # 2. CSI 300 via ASHR (PE data) + 000300.SS (price)
    try:
        csi = yf.Ticker('000300.SS')
        csi_info = csi.info
        csi_pe = csi_info.get('trailingPE')
        if csi_pe is None:
            try:
                ashr = yf.Ticker('ASHR')
                csi_pe = ashr.info.get('trailingPE')
            except:
                pass
        if csi_pe is None:
            csi_pe = 13.84
        data['csi300'] = {
            'price': get_price(csi),
            'pe': csi_pe,
            'forward_pe': csi_info.get('forwardPE'),
            'pb': csi_info.get('priceToBook'),
        }
    except Exception as e:
        data['csi300'] = {'error': str(e)}

    # 3. Macro
    macro_tickers = {'us10y': '^TNX', 'dxy': 'DX-Y.NYB', 'usdcny': 'CNY=X', 'gold': 'GC=F'}
    data['macro'] = {}
    for key, ticker in macro_tickers.items():
        try:
            t = yf.Ticker(ticker)
            info = t.info
            price = info.get('regularMarketPrice') or info.get('currentPrice')
            prev_close = info.get('regularMarketPreviousClose')
            change = round((price - prev_close) / prev_close * 100, 2) if price and prev_close else None
            data['macro'][key] = {'price': price, 'change': change}
        except Exception as e:
            data['macro'][key] = {'error': str(e)}

    # 4. Holdings
    holdings = {
        'NVDA': '英伟达', 'AAPL': '苹果', 'MSFT': '微软',
        'GOOGL': '谷歌', 'AMZN': '亚马逊', 'META': 'Meta',
        'TSLA': '特斯拉', 'AVGO': '博通', 'TSM': '台积电',
    }
    data['holdings'] = {}
    for ticker, name in holdings.items():
        try:
            t = yf.Ticker(ticker)
            info = t.info
            data['holdings'][ticker] = {
                'name': name, 'price': get_price(t),
                'pe': info.get('trailingPE'), 'forward_pe': info.get('forwardPE'),
                'gm': info.get('grossMargins'), 'nm': info.get('profitMargins'),
                'roe': info.get('returnOnEquity'), 'peg': info.get('pegRatio'),
                'revenue_growth': info.get('revenueGrowth'),
            }
        except Exception as e:
            data['holdings'][ticker] = {'name': name, 'error': str(e)}

    # 5. PE-DCA signals
    def calc_signal(pe, high, low):
        if pe is None:
            return 'N/A'
        pe = float(pe)
        return 'x0.5' if pe > high else ('x1.5' if pe < low else 'x1.0')

    nasdaq_pe = data.get('nasdaq100', {}).get('pe')
    csi_pe = data.get('csi300', {}).get('pe')
    nasdaq_signal = calc_signal(nasdaq_pe, 30, 20)
    csi_signal = calc_signal(csi_pe, 18, 10)

    if nasdaq_signal == 'x0.5':
        overall = '纳指PE偏高（>30），触发×0.5信号。建议纳指定投减半，资金可暂时存入货币基金等待PE回落。A股按正常节奏投入。'
        if csi_signal == 'x1.5':
            overall = '纳指PE偏高（×0.5），但A股PE低位（×1.5）。建议纳指减半投入，A股加倍投入，利用A股低估值机会。'
    elif nasdaq_signal == 'x1.5':
        overall = '纳指PE处于低位（<20），触发×1.5信号！市场恐慌时是最好的买入时机，建议加倍定投纳指。'
        if csi_signal == 'x1.5':
            overall = '两个市场PE均处于低位！罕见的历史性买入机会，建议双倍定投。'
    else:
        overall = '纳指PE处于正常区间，按原计划定投。'
        if csi_signal == 'x1.5':
            overall = '纳指正常投入，A股PE<10触发×1.5信号。建议A股加倍投入，纳指维持正常。'
        elif csi_signal == 'x0.5':
            overall = '纳指正常投入，但A股PE偏高（>18），触发×0.5信号。建议A股减半投入，纳指维持正常。'

    data['signals'] = {
        'nasdaq_signal': nasdaq_signal, 'csi_signal': csi_signal,
        'overall': overall,
        'nasdaq_pe_threshold': 'PE>30: x0.5 | PE 20-30: x1.0 | PE<20: x1.5',
        'csi_pe_threshold': 'PE>18: x0.5 | PE 10-18: x1.0 | PE<10: x1.5',
    }

    # 6. Personal portfolio (edit these numbers as they change)
    portfolio_pct = round(data.get('stock_index_value', 0) / data.get('total_assets', 1) * 100, 1)
    data['personal_portfolio'] = {
        'total_assets': 59366.02,
        'stock_index_value': 9256.70,
        'cash_value': 50099.32,
        'monthly_income': 7500,
        'monthly_living': 3500,
        'monthly_dca': 4000,
        'emergency_fund_target': 15000,
        'allocation_plan': {
            'nasdaq_pct': 55,
            'csi_pct': 45,
        },
        'dca_plan': {
            'total_deployable': 35099.32,
            'weekly_dca': 5000,
            'weeks_total': 7,
        },
        'current_multipliers': {
            'nasdaq': 0.5 if nasdaq_signal == 'x0.5' else (1.5 if nasdaq_signal == 'x1.5' else 1.0),
            'csi': 0.5 if csi_signal == 'x0.5' else (1.5 if csi_signal == 'x1.5' else 1.0),
        },
        'deployed': 9256.70,
    }

    # 7. Static knowledge
    data['knowledge'] = {
        'investment_framework': {
            'three_questions': [
                {'q': 'Q1: 赚钱效率高不高？', 'indicators': 'ROE、毛利率、净利率', 'source': '杜邦分析'},
                {'q': 'Q2: 增长可持续吗？', 'indicators': '营收增长、利润增长、利润>营收?', 'source': '损益表'},
                {'q': 'Q3: 价格合理吗？', 'indicators': 'PE、PEG、Forward PE', 'source': '估值分析'},
            ],
            'dupont_companies': [
                {'company': '英伟达', 'roe': '76.3%', 'driver': '净利率55.6% - 设计垄断', 'sustainable': '是(CUDA锁定)'},
                {'company': '台积电', 'roe': '31.7%', 'driver': '净利率44.6% - 制造垄断', 'sustainable': '是(制程领先)'},
                {'company': 'SK Hynix', 'roe': '35.6%', 'driver': '净利率56.9% - 周期紧缺', 'sustainable': '否(周期顶峰)'},
                {'company': '特斯拉', 'roe': '4.9%', 'driver': '净利率3.9% - 制造业', 'sustainable': '否(竞争加剧)'},
            ],
        },
        'macro_framework': {
            'five_forces': [
                {'name': '利率', 'weight': '35%', 'description': '美国/中国利率决定PE的定价锚',
                 'track': '美国10年期国债收益率、美联储利率、中国LPR'},
                {'name': '流动性', 'weight': '25%', 'description': '全球资金多寡决定资产价格水位',
                 'track': '美联储资产负债表、中国社融、M2增速'},
                {'name': '汇率', 'weight': '20%', 'description': '中美货币的相对价值',
                 'track': '美元指数(DXY)、人民币汇率'},
                {'name': '地缘/贸易', 'weight': '15%', 'description': '中美关系决定资本流动',
                 'track': '关税政策、科技封锁、台湾动态'},
                {'name': '中国财政', 'weight': '5%', 'description': 'A股由政策驱动远多于盈利',
                 'track': '中央经济工作会议、房地产政策、财政刺激'},
            ],
        },
        'ai_supply_chain': {
            'structure': [
                {'layer': '上游(芯片)', 'weight': '10.5%', 'companies': '英伟达、博通、台积电、光模块',
                 'key_metric': '英伟达毛利率>70%'},
                {'layer': '中游(云/平台)', 'weight': '11.6%', 'companies': '微软、谷歌、亚马逊',
                 'key_metric': '云厂商Capex增速'},
                {'layer': '下游(应用)', 'weight': '9.1%', 'companies': '苹果、Meta、特斯拉',
                 'key_metric': 'AI收入占比'},
                {'layer': '非AI', 'weight': '39%', 'companies': '金融、消费、工业(沪深300)',
                 'key_metric': '沪深300 PE'},
            ],
            'total_ai_exposure': '41%',
            'key_risk': '英伟达毛利率跌破65%或云厂商Capex增速<10%',
        },
    }

    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f'[OK] 数据已更新: {DATA_FILE}')
    print(f'     纳指 PE: {data.get("nasdaq100", {}).get("pe", "N/A")}')
    print(f'     沪深300 PE: {data.get("csi300", {}).get("pe", "N/A")}')
    print(f'     信号: 纳指{nasdaq_signal} / A股{csi_signal}')

if __name__ == '__main__':
    fetch_data()