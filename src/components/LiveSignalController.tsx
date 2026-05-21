import { useEffect, useState, useRef } from 'react'
import { Activity, ShoppingCart } from 'lucide-react'
import InfoTip from './InfoTip'

interface Props {
  symbol: string
  latestSignal: 'buy' | 'sell' | null
  latestSignalTime: number | null
  isLiveRange: boolean
}

interface LogEntry {
  time: string
  type: 'info' | 'success' | 'warn' | 'error'
  text: string
}

export default function LiveSignalController({ symbol, latestSignal, latestSignalTime, isLiveRange }: Props) {
  const [autoTrade, setAutoTrade] = useState(false)
  const [tradeSize, setTradeSize] = useState('0.1')
  const [botUrl, setBotUrl] = useState('http://localhost:3001')
  const [botStatus, setBotStatus] = useState<'offline' | 'checking' | 'online'>('checking')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  // Mock states for testing the auto-trade indicator integration without waiting for a candle close
  const [mockSignal, setMockSignal] = useState<'buy' | 'sell' | null>(null)
  const [mockSignalTime, setMockSignalTime] = useState<number | null>(null)

  const activeSignal = mockSignal || latestSignal
  const activeSignalTime = mockSignalTime || latestSignalTime

  // Track last processed signal time to avoid double-firing
  const lastProcessedSignalTime = useRef<number | null>(null)

  const hqAsset = symbol.replace(/USDT$/, '') // Convert ETHUSDT -> ETH

  // Helper to add logs
  const addLog = (text: string, type: LogEntry['type'] = 'info') => {
    const time = new Date().toLocaleTimeString()
    setLogs((prev) => [{ time, type, text }, ...prev].slice(0, 50))
  }

  // Check connection to local Express server
  const checkConnection = async () => {
    setBotStatus('checking')
    try {
      const res = await fetch(`${botUrl}/api/bots`, { mode: 'cors' })
      if (res.ok) {
        setBotStatus('online')
        addLog('Connected to local trading bot server!', 'success')
      } else {
        throw new Error('Unreachable')
      }
    } catch {
      setBotStatus('offline')
      addLog(`Bot server offline or unreachable at ${botUrl}`, 'error')
    }
  }

  useEffect(() => {
    checkConnection()
  }, [botUrl])

  // Handle direct market execution
  const executeMarketOrder = async (side: 'buy' | 'sell') => {
    if (isSubmitting) return
    setIsSubmitting(true)
    addLog(`Sending Market ${side.toUpperCase()} of ${tradeSize} ${hqAsset} to Hyperliquid via bot...`, 'info')
    
    try {
      const res = await fetch(`${botUrl}/api/trade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset: hqAsset,
          side,
          size: parseFloat(tradeSize),
        }),
        mode: 'cors',
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || `HTTP error ${res.status}`)
      }

      const data = await res.json()
      if (data.ok) {
        addLog(`Trade Success: ${data.msg || 'Order filled!'}`, 'success')
      } else {
        addLog(`Trade failed: ${JSON.stringify(data.status)}`, 'warn')
      }
    } catch (e: unknown) {
      addLog(`Execution error: ${e instanceof Error ? e.message : String(e)}`, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Helper to simulate a live indicator signal trigger for testing
  const triggerMockSignal = (side: 'buy' | 'sell') => {
    if (botStatus !== 'online') {
      addLog('Cannot simulate signals while bot is offline!', 'error')
      return
    }
    const timestamp = Date.now()
    setMockSignal(side)
    setMockSignalTime(timestamp)
    addLog(`Simulated live ${side.toUpperCase()} signal generated`, 'info')
  }

  // Listen for live indicator signal trigger on candle close (or mock triggers)
  useEffect(() => {
    if (!autoTrade || !activeSignal || !activeSignalTime || !isLiveRange) return
    
    // Check if this signal timestamp has already been processed
    if (lastProcessedSignalTime.current === activeSignalTime) return
    
    // Mark as processed immediately to prevent double-firing from re-renders
    lastProcessedSignalTime.current = activeSignalTime

    addLog(`Auto-Trade Triggered: New live ${activeSignal.toUpperCase()} signal at candle time ${new Date(activeSignalTime).toLocaleTimeString()}`, 'info')
    executeMarketOrder(activeSignal)

  }, [activeSignal, activeSignalTime, autoTrade, isLiveRange])

  return (
    <div className="card p-4 flex flex-col gap-4 border border-border bg-panel">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-2">
        <div className="flex items-center gap-2">
          <Activity className={`h-4 w-4 ${botStatus === 'online' ? 'text-gain animate-pulse' : 'text-dim'}`} />
          <h3 className="font-display text-sm font-semibold text-text">Live Execution</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${
            botStatus === 'online' ? 'bg-gain shadow-[0_0_8px_rgba(34,197,94,0.6)]' :
            botStatus === 'checking' ? 'bg-warn animate-pulse' : 'bg-loss'
          }`} />
          <span className="text-[10px] uppercase tracking-wider text-dim">
            {botStatus === 'online' ? 'Bot Online' : botStatus === 'checking' ? 'Checking' : 'Bot Offline'}
          </span>
        </div>
      </div>

      {/* Connection & Configuration */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-dim">
            Local Bot URL
            <InfoTip term="Local Bot URL" />
          </label>
          <div className="flex gap-1.5">
            <input
              type="text"
              className="flex-1 rounded border border-border bg-bg px-2 py-1 font-mono text-xs text-text outline-none focus:border-brand"
              value={botUrl}
              onChange={(e) => setBotUrl(e.target.value)}
            />
            <button
              onClick={checkConnection}
              className="rounded border border-border bg-panel px-2.5 py-1 text-xs text-text hover:bg-bg"
            >
              Retry
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-dim">
              Asset
              <InfoTip term="Hyperliquid Asset" />
            </label>
            <input
              type="text"
              readOnly
              className="rounded border border-border bg-bg px-2 py-1 font-mono text-xs text-dim cursor-not-allowed"
              value={hqAsset}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-dim">
              Size
              <InfoTip term="Signal Size" />
            </label>
            <input
              type="number"
              step="any"
              className="rounded border border-border bg-bg px-2 py-1 font-mono text-xs text-text outline-none focus:border-brand"
              value={tradeSize}
              onChange={(e) => setTradeSize(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Auto-Trade Switch */}
      <div className="flex flex-col gap-2 rounded-md border border-border bg-panel-2 p-2.5">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-text">Auto-Trade Signals</span>
            <span className="text-[10px] text-dim">Sends BUY/SELL indicator signals to bot</span>
          </div>
          <button
            disabled={!isLiveRange || botStatus !== 'online'}
            onClick={() => {
              if (botStatus !== 'online') {
                addLog('Cannot enable Auto-Trade while bot is offline!', 'error')
                return
              }
              setAutoTrade(!autoTrade)
              addLog(autoTrade ? 'Auto-Trade Disabled' : 'Auto-Trade Enabled', autoTrade ? 'warn' : 'success')
            }}
            className={`flex h-6 w-11 cursor-pointer items-center rounded-full p-0.5 transition-colors duration-200 focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${
              autoTrade ? 'bg-brand' : 'bg-border'
            }`}
          >
            <div
              className={`h-5 w-5 rounded-full bg-white shadow-md transform transition-transform duration-200 ${
                autoTrade ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
        {!isLiveRange && (
          <div className="text-[9px] text-warn font-semibold">
            * Auto-trade requires Live mode (Current range: Historical)
          </div>
        )}
      </div>

      {/* Manual Execution Actions */}
      <div className="flex flex-col gap-1.5">
        <label className="text-[10px] font-bold uppercase tracking-wider text-dim">Manual Execution Test</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            disabled={botStatus !== 'online' || isSubmitting}
            onClick={() => executeMarketOrder('buy')}
            className="flex items-center justify-center gap-1.5 rounded-md bg-gain px-3 py-2 text-xs font-semibold text-black hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 transition-opacity"
          >
            <ShoppingCart className="h-3.5 w-3.5" />
            Buy Market
          </button>
          <button
            disabled={botStatus !== 'online' || isSubmitting}
            onClick={() => executeMarketOrder('sell')}
            className="flex items-center justify-center gap-1.5 rounded-md bg-loss px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 transition-opacity"
          >
            <ShoppingCart className="h-3.5 w-3.5" />
            Sell Market
          </button>
        </div>
      </div>

      {/* Mock Indicator Signal Simulator */}
      <div className="flex flex-col gap-1.5 border-t border-border/40 pt-2.5">
        <div className="flex items-center justify-between">
          <label className="text-[10px] font-bold uppercase tracking-wider text-dim">Mock Signal Trigger</label>
          {!autoTrade && <span className="text-[9px] text-warn font-semibold">Enable Auto-Trade first</span>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            disabled={botStatus !== 'online' || isSubmitting}
            onClick={() => triggerMockSignal('buy')}
            className="flex items-center justify-center gap-1 rounded border border-gain/35 bg-gain/5 hover:bg-gain/10 px-2 py-1.5 text-xs font-semibold text-gain disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
          >
            Simulate BUY
          </button>
          <button
            disabled={botStatus !== 'online' || isSubmitting}
            onClick={() => triggerMockSignal('sell')}
            className="flex items-center justify-center gap-1 rounded border border-loss/35 bg-loss/5 hover:bg-loss/10 px-2 py-1.5 text-xs font-semibold text-loss disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
          >
            Simulate SELL
          </button>
        </div>
      </div>

      {/* Terminal Log */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-bold uppercase tracking-wider text-dim">Execution Activity Log</label>
        <div className="h-28 overflow-y-auto rounded-md border border-border bg-bg p-2 font-mono text-[10px] leading-relaxed text-text">
          {logs.length === 0 ? (
            <div className="flex h-full items-center justify-center text-dim">
              No executions logged. Click Buy/Sell to test.
            </div>
          ) : (
            logs.map((log, i) => (
              <div key={i} className="mb-1.5 last:mb-0 break-words">
                <span className="text-dim">[{log.time}]</span>{' '}
                <span
                  className={
                    log.type === 'success' ? 'text-gain font-medium' :
                    log.type === 'error' ? 'text-loss font-medium' :
                    log.type === 'warn' ? 'text-warn font-medium' : 'text-brand'
                  }
                >
                  {log.text}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
