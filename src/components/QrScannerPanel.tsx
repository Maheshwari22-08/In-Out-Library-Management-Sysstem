import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, CameraOff, Keyboard, ScanLine, CheckCircle2, AlertCircle } from 'lucide-react';

interface QrScannerPanelProps {
  mode: 'kiosk' | 'student';
  onScanPayload: (payload: string) => Promise<{
    action?: 'IN' | 'OUT';
    message: string;
    studentName?: string;
    prn?: string;
    program?: string;
    visitCount?: number;
  }>;
  sampleCodes?: Array<{ label: string; payload: string }>;
}

export const QrScannerPanel: React.FC<QrScannerPanelProps> = ({
  mode,
  onScanPayload,
  sampleCodes = [],
}) => {
  const [cameraActive, setCameraActive] = useState(false);
  const [manualInput, setManualInput] = useState('');
  const [processing, setProcessing] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    action?: 'IN' | 'OUT';
    title: string;
    detail: string;
  } | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScannedRef = useRef<{ value: string; ts: number }>({ value: '', ts: 0 });
  const containerId = mode === 'kiosk' ? 'diet-kiosk-qr-reader' : 'diet-student-qr-reader';

  const stopCamera = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
      } catch {
        // ignore cleanup warnings
      }
      scannerRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const handleDecoded = async (decodedText: string) => {
    const now = Date.now();
    if (
      lastScannedRef.current.value === decodedText &&
      now - lastScannedRef.current.ts < 3000
    ) {
      return;
    }
    lastScannedRef.current = { value: decodedText, ts: now };
    setProcessing(true);
    try {
      const res = await onScanPayload(decodedText);
      setFeedback({
        type: 'success',
        action: res.action,
        title: res.action
          ? `Recorded ${res.action === 'IN' ? 'Library Check-In' : 'Library Check-Out'}`
          : 'Scan Verified',
        detail: res.message,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        title: 'Scan Rejected',
        detail: err instanceof Error ? err.message : 'Unable to process QR code.',
      });
    } finally {
      setProcessing(false);
    }
  };

  const startCamera = async () => {
    setFeedback(null);
    try {
      const qr = new Html5Qrcode(containerId);
      scannerRef.current = qr;
      setCameraActive(true);
      await qr.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 230, height: 230 } },
        (decodedText) => {
          handleDecoded(decodedText);
        },
        () => {
          // frame decode miss is normal
        }
      );
    } catch (err) {
      setCameraActive(false);
      setFeedback({
        type: 'error',
        title: 'Camera Unavailable',
        detail:
          err instanceof Error
            ? `${err.message}. You can use a USB barcode/QR scanner or enter the PRN / QR token below.`
            : 'Camera access denied. Use USB scanner or manual PRN entry below.',
      });
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualInput.trim() || processing) return;
    const val = manualInput.trim();
    setManualInput('');
    await handleDecoded(val);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">
            {mode === 'kiosk'
              ? 'Central Gate QR & Barcode Scanner'
              : 'Self-Service Gate QR Check-In / Out'}
          </h3>
          <p className="text-sm text-slate-500 mt-0.5">
            {mode === 'kiosk'
              ? 'Scan a student digital QR card or physical ID barcode to automatically log IN or OUT.'
              : 'Point your device camera at the Central Library Gate QR poster to record your attendance.'}
          </p>
        </div>

        <button
          type="button"
          onClick={cameraActive ? stopCamera : startCamera}
          className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
            cameraActive
              ? 'bg-slate-900 text-white hover:bg-slate-800'
              : 'bg-[#0F2942] text-white hover:bg-[#163A5C]'
          }`}
        >
          {cameraActive ? <CameraOff className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
          {cameraActive ? 'Stop Camera' : 'Start Camera Scanner'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-5">
        <div className="lg:col-span-6">
          <div className="relative bg-slate-950 rounded-lg overflow-hidden border border-slate-200 min-h-[260px] flex flex-col items-center justify-center">
            <div id={containerId} className="w-full" />
            {!cameraActive && (
              <div className="p-6 text-center max-w-xs">
                <ScanLine className="w-10 h-10 text-slate-400 mx-auto mb-3" />
                <p className="text-sm font-medium text-slate-200">
                  Camera Scanner Standby
                </p>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  Click &ldquo;Start Camera Scanner&rdquo; for live optical QR detection, or use the USB scanner input on the right.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-6 flex flex-col justify-between gap-5">
          <form onSubmit={handleManualSubmit} className="space-y-3">
            <label className="block text-sm font-medium text-slate-700">
              <span className="inline-flex items-center gap-1.5">
                <Keyboard className="w-4 h-4 text-slate-500" />
                {mode === 'kiosk'
                  ? 'USB Scanner Wedge / Student PRN Input'
                  : 'Gate QR Payload Entry'}
              </span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder={
                  mode === 'kiosk'
                    ? 'Scan QR or enter PRN (e.g. DEG-CS-2401)'
                    : 'DIET-GATE:CENTRAL-LIBRARY-SATARA'
                }
                className="flex-1 px-3.5 py-2.5 text-sm font-mono-tabular bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F2942]/20 focus:border-[#0F2942]"
              />
              <button
                type="submit"
                disabled={processing || !manualInput.trim()}
                className="px-4 py-2.5 bg-[#0F2942] text-white text-sm font-medium rounded-lg hover:bg-[#163A5C] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                {processing ? 'Recording...' : 'Record Scan'}
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Hardware 2D barcode/QR scanners connected via USB automatically type into this field and press Enter.
            </p>
          </form>

          {sampleCodes.length > 0 && (
            <div className="pt-3 border-t border-slate-200">
              <p className="text-xs font-medium text-slate-500 mb-2">
                Quick Gate Verification Presets
              </p>
              <div className="flex flex-wrap gap-2">
                {sampleCodes.map((sample) => (
                  <button
                    key={sample.payload}
                    type="button"
                    disabled={processing}
                    onClick={() => handleDecoded(sample.payload)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0"
                  >
                    {sample.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {feedback && (
            <div
              className={`p-4 rounded-lg border ${
                feedback.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-red-50 border-red-200 text-red-900'
              }`}
            >
              <div className="flex items-start gap-3">
                {feedback.type === 'success' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="text-sm font-semibold">{feedback.title}</p>
                  <p className="text-xs mt-1 leading-relaxed">{feedback.detail}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
