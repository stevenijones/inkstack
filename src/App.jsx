import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Layers, Download, Image as ImageIcon, Sliders, Scissors, RefreshCw, Info, Check, Eye, EyeOff, Sparkles, Palette, Droplet, FolderDown, Crop, X, Puzzle } from 'lucide-react';

// Simple tooltip component
const Tooltip = ({ children, text }) => (
  <div className="group relative flex flex-col items-center">
    {children}
    <div className="absolute bottom-full mb-2 hidden flex-col items-center group-hover:flex">
      <span className="relative z-10 p-2 text-xs leading-none text-white whitespace-no-wrap bg-gray-800 shadow-lg rounded-md">
        {text}
      </span>
      <div className="w-3 h-3 -mt-2 rotate-45 bg-gray-800"></div>
    </div>
  </div>
);

// Helper to manage colors
const hexToRgb = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
};

const blendColors = (bg, fg) => {
  // Multiply blend mode simulation for ink
  return {
    r: Math.floor((bg.r * fg.r) / 255),
    g: Math.floor((bg.g * fg.g) / 255),
    b: Math.floor((bg.b * fg.b) / 255)
  };
};

export default function App() {
  // State
  const [image, setImage] = useState(null); // Triggers re-renders when image structure changes
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 }); // Current working dimensions
  
  // Processing State
  const [layerCount, setLayerCount] = useState(3);
  const [thresholds, setThresholds] = useState([85, 170]); 
  const [blurAmount, setBlurAmount] = useState(0); 

  // View State
  const [activeTab, setActiveTab] = useState('composite'); // 'composite' or 'layers'
  const [selectedLayerIndex, setSelectedLayerIndex] = useState(0); 
  const [inverted, setInverted] = useState(false); 
  const [cutMode, setCutMode] = useState('stack'); // 'stack' (Reduction/Overlap) or 'zone' (Isolated)

  // Color State
  const [isColorMode, setIsColorMode] = useState(false);
  const [blendMode, setBlendMode] = useState('multiply'); // 'normal' or 'multiply'
  const [paperColor, setPaperColor] = useState('#ffffff');
  const [inkColors, setInkColors] = useState(['#facc15', '#ef4444', '#171717', '#000000']); 
  
  const [isExporting, setIsExporting] = useState(false);

  // Crop State
  const [isCropping, setIsCropping] = useState(false);
  const [cropRect, setCropRect] = useState(null); // { x, y, w, h }
  const [isSelectingCrop, setIsSelectingCrop] = useState(false);
  const [cropStart, setCropStart] = useState({ x: 0, y: 0 });

  // Refs
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const sourceImageRef = useRef(null); // The current WORKING image (potentially cropped)
  const originalImageRef = useRef(null); // The MASTER uploaded image (uncropped)

  // Initialize thresholds when layer count changes
  useEffect(() => {
    const count = layerCount - 1;
    const newThresholds = [];
    const step = 255 / layerCount;
    for (let i = 1; i <= count; i++) {
      newThresholds.push(Math.round(step * i));
    }
    setThresholds(newThresholds);
    if (selectedLayerIndex >= layerCount) {
      setSelectedLayerIndex(0);
    }
  }, [layerCount]);

  // Ensure ink colors array matches needed size (layerCount - 1 inks)
  useEffect(() => {
    const neededInks = layerCount - 1;
    setInkColors(prev => {
        if (prev.length === neededInks) return prev;
        const newInks = [...prev];
        if (newInks.length < neededInks) {
            // Add defaults if increasing
            const defaults = ['#facc15', '#ef4444', '#1e40af', '#171717'];
            while (newInks.length < neededInks) {
                newInks.push(defaults[newInks.length] || '#000000');
            }
        } else {
            // Trim if decreasing
            newInks.length = neededInks;
        }
        return newInks;
    });
  }, [layerCount]);

  // Handle Image Upload
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const maxDim = 1200;
        let width = img.width;
        let height = img.height;
        
        // Resize large images
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        // Store as Master
        const masterCanvas = document.createElement('canvas');
        masterCanvas.width = width;
        masterCanvas.height = height;
        masterCanvas.getContext('2d').drawImage(img, 0, 0, width, height);
        
        const optimizedImg = new Image();
        optimizedImg.src = masterCanvas.toDataURL();
        optimizedImg.onload = () => {
            originalImageRef.current = optimizedImg;
            sourceImageRef.current = optimizedImg; // Initially, working = master
            setImageDimensions({ width, height });
            setImage(optimizedImg);
            setCropRect({ x: 0, y: 0, w: width, h: height });
        };
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  // --- CROP HANDLERS ---
  const startCropMode = () => {
      if (!originalImageRef.current) return;
      setIsCropping(true);
      // Default crop rect to full image if not set
      if (!cropRect) {
          setCropRect({ 
              x: 0, 
              y: 0, 
              w: originalImageRef.current.width, 
              h: originalImageRef.current.height 
          });
      }
  };

  const cancelCrop = () => {
      setIsCropping(false);
      setIsSelectingCrop(false);
  };

  const applyCrop = () => {
      if (!cropRect || !originalImageRef.current) return;
      
      const { x, y, w, h } = cropRect;
      if (w === 0 || h === 0) return;

      // Ensure positive width/height for canvas
      const finalX = w < 0 ? x + w : x;
      const finalY = h < 0 ? y + h : y;
      const finalW = Math.abs(w);
      const finalH = Math.abs(h);

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = finalW;
      tempCanvas.height = finalH;
      const ctx = tempCanvas.getContext('2d');
      
      ctx.drawImage(originalImageRef.current, finalX, finalY, finalW, finalH, 0, 0, finalW, finalH);
      
      const newImg = new Image();
      newImg.src = tempCanvas.toDataURL();
      newImg.onload = () => {
          sourceImageRef.current = newImg;
          setImageDimensions({ width: finalW, height: finalH });
          setImage(newImg); // Trigger re-render
          setIsCropping(false);
      };
  };

  const resetToOriginal = () => {
      if (!originalImageRef.current) return;
      sourceImageRef.current = originalImageRef.current;
      setImageDimensions({ 
          width: originalImageRef.current.width, 
          height: originalImageRef.current.height 
      });
      setImage(originalImageRef.current);
      setIsCropping(false);
      setCropRect({ x: 0, y: 0, w: originalImageRef.current.width, h: originalImageRef.current.height });
  };

  // --- CROP MOUSE EVENTS ---
  const handleMouseDown = (e) => {
      if (!isCropping || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const scaleX = canvasRef.current.width / rect.width;
      const scaleY = canvasRef.current.height / rect.height;
      
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;
      
      setIsSelectingCrop(true);
      setCropStart({ x, y });
      setCropRect({ x, y, w: 0, h: 0 });
  };

  const handleMouseMove = (e) => {
      if (!isCropping || !isSelectingCrop || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const scaleX = canvasRef.current.width / rect.width;
      const scaleY = canvasRef.current.height / rect.height;
      
      const currentX = (e.clientX - rect.left) * scaleX;
      const currentY = (e.clientY - rect.top) * scaleY;
      
      setCropRect({
          x: cropStart.x,
          y: cropStart.y,
          w: currentX - cropStart.x,
          h: currentY - cropStart.y
      });
  };

  const handleMouseUp = () => {
      setIsSelectingCrop(false);
  };

  // Reusable Render Function
  const renderToContext = useCallback((ctx, width, height, overrides = {}) => {
    const config = {
      activeTab,
      layerCount,
      thresholds,
      blurAmount,
      selectedLayerIndex,
      inverted,
      cutMode,
      isColorMode,
      paperColor,
      inkColors,
      blendMode,
      isCropping,
      cropRect,
      ...overrides
    };

    // --- CROP RENDER MODE ---
    if (config.isCropping && originalImageRef.current) {
        const master = originalImageRef.current;
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(master, 0, 0);
        
        // Draw overlay
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.fillRect(0, 0, width, height);
        
        // Draw selection
        if (config.cropRect) {
            const { x, y, w, h } = config.cropRect;
            ctx.clearRect(x, y, w, h);
            ctx.drawImage(master, x, y, w, h, x, y, w, h);
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 3]);
            ctx.strokeRect(x, y, w, h);
        }
        return;
    }

    // --- NORMAL RENDER MODE ---
    if (!sourceImageRef.current) return;

    ctx.clearRect(0, 0, width, height);

    if (config.blurAmount > 0) {
        ctx.filter = `blur(${config.blurAmount}px)`;
    } else {
        ctx.filter = 'none';
    }
    
    ctx.drawImage(sourceImageRef.current, 0, 0, width, height);
    ctx.filter = 'none'; 
    
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const sortedThresholds = [...config.thresholds].sort((a, b) => a - b);

    // PRE-CALCULATE COLORS FOR EACH BUCKET
    const bucketColors = [];
    
    if (config.activeTab === 'composite' && config.isColorMode) {
        const bgRgb = hexToRgb(config.paperColor);
        const inksRgb = config.inkColors.map(hexToRgb);

        for (let b = 0; b < config.layerCount; b++) {
            let currentRGB = { ...bgRgb };
            const inksToApplyCount = (config.layerCount - 1) - b; 
            
            if (config.blendMode === 'multiply') {
                for (let i = 0; i < inksToApplyCount; i++) {
                    if (inksRgb[i]) {
                        currentRGB = blendColors(currentRGB, inksRgb[i]);
                    }
                }
            } else {
                if (inksToApplyCount > 0) {
                     currentRGB = inksRgb[inksToApplyCount - 1];
                }
            }
            bucketColors.push(currentRGB);
        }
    }

    // Processing loop
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;

      if (config.activeTab === 'composite') {
        // --- COMPOSITE PREVIEW MODE ---
        let bucketIndex = config.layerCount - 1; // Default to Paper
        
        for (let t = 0; t < sortedThresholds.length; t++) {
          if (gray < sortedThresholds[t]) {
            bucketIndex = t;
            break;
          }
        }

        if (config.isColorMode) {
            const c = bucketColors[bucketIndex];
            data[i] = c.r;
            data[i+1] = c.g;
            data[i+2] = c.b;
        } else {
            // BW Mode
            const val = Math.round((bucketIndex / (config.layerCount - 1)) * 255); 
            data[i] = val;
            data[i + 1] = val;
            data[i + 2] = val;
        }

      } else {
        // --- CUT GUIDE MODE ---
        
        if (config.cutMode === 'zone') {
             // --- ZONE MODE (ISOLATED) ---
             // Determine exact bucket
             let bucketIndex = config.layerCount - 1; // Default to Paper (Bucket N)
             for (let t = 0; t < sortedThresholds.length; t++) {
                if (gray < sortedThresholds[t]) {
                  bucketIndex = t;
                  break;
                }
             }
             
             // In Zone mode, 'selectedLayerIndex' 0 (Step 1) typically corresponds to the lightest INK.
             // Buckets: 0(Black), 1(DarkGrey), ... N-2(LightGrey), N-1(Paper)
             // Step 1: Bucket N-2.
             // Step 2: Bucket N-3.
             // Step N: Bucket 0.
             const targetBucket = (config.layerCount - 1) - (config.selectedLayerIndex + 1);
             
             let isKeep = (bucketIndex === targetBucket);
             if (config.inverted) isKeep = !isKeep;
             const out = isKeep ? 0 : 255;
             data[i] = out;
             data[i + 1] = out;
             data[i + 2] = out;

        } else {
            // --- STACK MODE (REDUCTION) ---
            const thresholdIndex = sortedThresholds.length - 1 - config.selectedLayerIndex;
            
            if (thresholdIndex < 0) {
                 data[i] = 255; data[i+1] = 255; data[i+2] = 255;
            } else {
                const cutThreshold = sortedThresholds[thresholdIndex];
                let isKeep = gray < cutThreshold; 
                if (config.inverted) isKeep = !isKeep;
                const out = isKeep ? 0 : 255;
                data[i] = out;
                data[i + 1] = out;
                data[i + 2] = out;
            }
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);
  }, [activeTab, layerCount, thresholds, blurAmount, selectedLayerIndex, inverted, cutMode, isColorMode, paperColor, inkColors, blendMode, isCropping, cropRect]);

  // Main Effect
  useEffect(() => {
    if (image && canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d');
        
        let w, h;
        if (isCropping && originalImageRef.current) {
             w = originalImageRef.current.width;
             h = originalImageRef.current.height;
        } else {
             w = imageDimensions.width;
             h = imageDimensions.height;
        }
        
        canvasRef.current.width = w;
        canvasRef.current.height = h;
        renderToContext(ctx, w, h);
    }
  }, [image, imageDimensions, isCropping, cropRect, renderToContext]);

  const handleSliderChange = (index, value) => {
    const newThresholds = [...thresholds];
    newThresholds[index] = parseInt(value, 10);
    setThresholds(newThresholds);
  };
  
  const handleInkColorChange = (index, value) => {
      const newInks = [...inkColors];
      newInks[index] = value;
      setInkColors(newInks);
  };

  const downloadFile = (canvas, filename) => {
      const link = document.createElement('a');
      link.download = filename;
      link.href = canvas.toDataURL();
      link.click();
  };

  const handleDownloadSingle = () => {
    if (!canvasRef.current) return;
    const suffix = activeTab === 'composite' ? 'preview' : `cut-step-${selectedLayerIndex + 1}`;
    downloadFile(canvasRef.current, `linocut-${suffix}.png`);
  };

  const handleDownloadAll = async () => {
      if (!sourceImageRef.current) return;
      setIsExporting(true);

      const { width, height } = imageDimensions;
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = width;
      tempCanvas.height = height;
      const ctx = tempCanvas.getContext('2d');

      // 1. Download Composite Preview
      renderToContext(ctx, width, height, { activeTab: 'composite', isCropping: false });
      downloadFile(tempCanvas, 'linocut-00-preview.png');
      await new Promise(r => setTimeout(r, 200));

      // 2. Download All Cut Guides
      for (let i = 0; i < layerCount - 1; i++) {
          renderToContext(ctx, width, height, { 
              activeTab: 'layers',
              selectedLayerIndex: i,
              inverted: inverted,
              cutMode: cutMode,
              isCropping: false
          });
          const modePrefix = cutMode === 'zone' ? 'isolated' : 'reduction';
          downloadFile(tempCanvas, `linocut-${modePrefix}-0${i + 1}-step-${i + 1}.png`);
          await new Promise(r => setTimeout(r, 200));
      }

      setIsExporting(false);
  };

  return (
    <div className="flex flex-col h-screen bg-neutral-900 text-neutral-100 font-sans overflow-hidden">
      {/* Header */}
      <header className="h-16 border-b border-neutral-800 flex items-center px-6 justify-between bg-neutral-900 z-10 shrink-0">
        <div className="flex items-center space-x-3">
          <Layers className="w-6 h-6 text-emerald-500" />
          <h1 className="text-xl font-bold tracking-tight">InkStack</h1>
        </div>
        
        <div className="flex items-center space-x-3">
           {image && !isCropping && (
             <>
                <button 
                onClick={handleDownloadAll}
                disabled={isExporting}
                className="flex items-center space-x-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-wait px-4 py-2 rounded-lg transition-colors text-sm font-medium text-white shadow-lg shadow-emerald-900/20"
                >
                <FolderDown className="w-4 h-4" />
                <span>{isExporting ? 'Exporting...' : 'Export All Assets'}</span>
                </button>
                <div className="h-6 w-px bg-neutral-700 mx-2"></div>
                <button 
                onClick={handleDownloadSingle}
                className="flex items-center space-x-2 bg-neutral-800 hover:bg-neutral-700 px-4 py-2 rounded-lg transition-colors text-sm font-medium"
                >
                <Download className="w-4 h-4" />
                <span>Download View</span>
                </button>
             </>
           )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Controls */}
        <aside className="w-80 bg-neutral-900 border-r border-neutral-800 flex flex-col overflow-y-auto shrink-0 custom-scrollbar">
          <div className="p-6 space-y-8 pb-20">
            
            {/* 1. Upload & Crop Section */}
            <div className="space-y-4">
              <h2 className="text-xs font-bold text-neutral-500 uppercase tracking-wider">1. Source Image</h2>
              
              {!isCropping ? (
                  <div className="space-y-3">
                      <div 
                        onClick={() => fileInputRef.current?.click()}
                        className="border-2 border-dashed border-neutral-700 hover:border-emerald-500 hover:bg-neutral-800 rounded-xl p-6 cursor-pointer transition-all flex flex-col items-center justify-center text-center group relative overflow-hidden"
                      >
                        <input 
                          type="file" 
                          ref={fileInputRef} 
                          onChange={handleImageUpload} 
                          className="hidden" 
                          accept="image/*"
                        />
                        {image ? (
                          <div className="space-y-2 relative z-10">
                            <div className="w-16 h-16 bg-neutral-800 rounded-lg overflow-hidden mx-auto border border-neutral-600">
                              <img src={sourceImageRef.current?.src} alt="Source" className="w-full h-full object-cover opacity-70 group-hover:opacity-100 transition-opacity" />
                            </div>
                            <p className="text-xs text-emerald-400 font-medium">Change Image</p>
                          </div>
                        ) : (
                          <>
                            <Upload className="w-8 h-8 text-neutral-500 group-hover:text-emerald-500 mb-3 transition-colors" />
                            <p className="text-sm text-neutral-400 font-medium group-hover:text-neutral-200">Click to upload photo</p>
                          </>
                        )}
                      </div>

                      {image && (
                          <div className="flex space-x-2">
                             <button
                                onClick={startCropMode}
                                className="flex-1 flex items-center justify-center space-x-2 bg-neutral-800 hover:bg-neutral-700 py-2 rounded-lg text-sm text-neutral-300 transition-colors"
                             >
                                <Crop className="w-4 h-4" />
                                <span>Crop Image</span>
                             </button>
                             <button
                                onClick={resetToOriginal}
                                className="px-3 bg-neutral-800 hover:bg-neutral-700 rounded-lg text-neutral-400 hover:text-white transition-colors"
                                title="Reset to original upload"
                             >
                                <RefreshCw className="w-4 h-4" />
                             </button>
                          </div>
                      )}
                  </div>
              ) : (
                  <div className="bg-neutral-800/50 rounded-xl p-4 border border-emerald-500/30 animate-in slide-in-from-left duration-200">
                      <div className="flex items-center space-x-2 mb-3 text-emerald-400">
                          <Crop className="w-4 h-4" />
                          <span className="font-bold text-sm">Crop Mode</span>
                      </div>
                      <p className="text-xs text-neutral-400 mb-4">
                          Drag on the image to select the area you want to keep.
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={cancelCrop}
                            className="py-2 rounded-lg text-sm bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={applyCrop}
                            className="py-2 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition-colors"
                          >
                            Apply Crop
                          </button>
                      </div>
                  </div>
              )}
            </div>

            {/* 2. Image Prep / Smoothing */}
            <div className={`space-y-4 transition-opacity duration-300 ${!image || isCropping ? 'opacity-30 pointer-events-none' : 'opacity-100'}`}>
                <div className="flex items-center justify-between">
                    <h2 className="text-xs font-bold text-neutral-500 uppercase tracking-wider">2. Smoothing</h2>
                    <Sparkles className="w-4 h-4 text-emerald-500" />
                </div>
                <div className="bg-neutral-800/50 p-4 rounded-xl border border-neutral-800 space-y-3">
                    <div className="flex justify-between text-xs text-neutral-400">
                        <span>Detail Reduction</span>
                        <span className="font-mono text-emerald-400">{blurAmount}px</span>
                    </div>
                    <input
                        type="range"
                        min="0"
                        max="20"
                        step="0.5"
                        value={blurAmount}
                        onChange={(e) => setBlurAmount(parseFloat(e.target.value))}
                        className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-emerald-500 hover:accent-emerald-400"
                    />
                </div>
            </div>

            {/* 3. Layer Configuration */}
            <div className={`space-y-4 transition-opacity duration-300 ${!image || isCropping ? 'opacity-30 pointer-events-none' : 'opacity-100'}`}>
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold text-neutral-500 uppercase tracking-wider">3. Layers</h2>
                <span className="text-xs bg-neutral-800 px-2 py-1 rounded text-neutral-300">{layerCount} Layers</span>
              </div>
              
              <div className="grid grid-cols-3 gap-2">
                {[3, 4, 5].map((num) => (
                  <button
                    key={num}
                    onClick={() => setLayerCount(num)}
                    className={`py-2 text-sm font-medium rounded-lg border transition-all ${
                      layerCount === num 
                        ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400' 
                        : 'bg-neutral-800 border-transparent text-neutral-400 hover:bg-neutral-700'
                    }`}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>

            {/* 4. Threshold Sliders */}
            <div className={`space-y-6 transition-opacity duration-300 ${!image || isCropping ? 'opacity-30 pointer-events-none' : 'opacity-100'}`}>
               <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold text-neutral-500 uppercase tracking-wider">4. Thresholds</h2>
                <Sliders className="w-4 h-4 text-neutral-600" />
              </div>

              <div className="space-y-6 relative">
                 {thresholds.map((t, idx) => (
                   <div key={idx} className="space-y-2">
                     <div className="flex justify-between text-xs text-neutral-400">
                       <span>{idx === 0 ? "Dark/Mid" : idx === thresholds.length - 1 ? "Mid/Light" : `Level ${idx + 1}`}</span>
                       <span className="font-mono text-neutral-500">{t}</span>
                     </div>
                     <input
                       type="range"
                       min="0"
                       max="255"
                       value={t}
                       onChange={(e) => handleSliderChange(idx, e.target.value)}
                       className="w-full h-1.5 bg-neutral-700 rounded-lg appearance-none cursor-pointer accent-emerald-500 hover:accent-emerald-400"
                     />
                   </div>
                 ))}
              </div>
            </div>
            
            {/* 5. Colors Configuration */}
            <div className={`space-y-4 transition-opacity duration-300 ${!image || isCropping ? 'opacity-30 pointer-events-none' : 'opacity-100'}`}>
               <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold text-neutral-500 uppercase tracking-wider">5. Colors</h2>
                <Palette className="w-4 h-4 text-neutral-600" />
              </div>
              
              <div className="bg-neutral-800/50 p-4 rounded-xl border border-neutral-800 space-y-4">
                  <div className="flex items-center space-x-3 pb-2 border-b border-neutral-700">
                      <div 
                        onClick={() => setIsColorMode(!isColorMode)}
                        className={`w-10 h-5 rounded-full relative cursor-pointer transition-colors ${isColorMode ? 'bg-emerald-500' : 'bg-neutral-600'}`}
                      >
                          <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${isColorMode ? 'left-6' : 'left-1'}`}></div>
                      </div>
                      <span className="text-sm font-medium text-neutral-300">{isColorMode ? 'Color Mode' : 'Grayscale'}</span>
                  </div>
                  
                  {isColorMode && (
                      <div className="space-y-3 animate-in fade-in duration-300">
                          {/* Blend Mode Toggle */}
                          <div className="flex items-center justify-between text-xs text-neutral-400">
                              <span>Simulation Mode</span>
                              <button 
                                onClick={() => setBlendMode(blendMode === 'normal' ? 'multiply' : 'normal')}
                                className="flex items-center space-x-1 hover:text-white"
                              >
                                  <Droplet className="w-3 h-3" />
                                  <span>{blendMode === 'multiply' ? 'Ink Merge' : 'Opaque'}</span>
                              </button>
                          </div>

                          {/* Paper */}
                          <div className="flex items-center justify-between">
                              <span className="text-xs text-neutral-400">Paper (Base)</span>
                              <input 
                                type="color" 
                                value={paperColor}
                                onChange={(e) => setPaperColor(e.target.value)}
                                className="w-8 h-8 rounded cursor-pointer bg-transparent border-0"
                              />
                          </div>
                          
                          {/* Inks */}
                          {inkColors.map((color, idx) => (
                              <div key={idx} className="flex items-center justify-between">
                                  <span className="text-xs text-neutral-400">Ink {idx + 1} ({idx === 0 ? 'Lightest' : idx === inkColors.length - 1 ? 'Darkest' : 'Mid'})</span>
                                  <input 
                                    type="color" 
                                    value={color}
                                    onChange={(e) => handleInkColorChange(idx, e.target.value)}
                                    className="w-8 h-8 rounded cursor-pointer bg-transparent border-0"
                                  />
                              </div>
                          ))}
                      </div>
                  )}
              </div>
            </div>

             {/* 6. View Mode */}
             <div className={`space-y-4 transition-opacity duration-300 ${!image || isCropping ? 'opacity-30 pointer-events-none' : 'opacity-100'}`}>
                <h2 className="text-xs font-bold text-neutral-500 uppercase tracking-wider">6. View</h2>
                
                <div className="bg-neutral-800 p-1 rounded-lg flex space-x-1">
                  <button
                    onClick={() => setActiveTab('composite')}
                    className={`flex-1 flex items-center justify-center space-x-2 py-2 rounded-md text-sm font-medium transition-all ${
                      activeTab === 'composite' 
                        ? 'bg-neutral-700 shadow text-white' 
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    <ImageIcon className="w-4 h-4" />
                    <span>Composite</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('layers')}
                    className={`flex-1 flex items-center justify-center space-x-2 py-2 rounded-md text-sm font-medium transition-all ${
                      activeTab === 'layers' 
                        ? 'bg-neutral-700 shadow text-white' 
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    <Scissors className="w-4 h-4" />
                    <span>Cut Guides</span>
                  </button>
                </div>

                {activeTab === 'layers' && (
                  <div className="space-y-3 bg-neutral-800/50 p-4 rounded-xl border border-neutral-800">
                    <p className="text-xs text-neutral-400 mb-2 font-medium uppercase">Select Cut Stage:</p>
                    <div className="flex flex-col space-y-2">
                      {Array.from({ length: layerCount - 1 }).map((_, idx) => (
                        <button
                          key={idx}
                          onClick={() => setSelectedLayerIndex(idx)}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all border ${
                            selectedLayerIndex === idx
                              ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-100'
                              : 'bg-neutral-800 border-transparent text-neutral-400 hover:bg-neutral-700'
                          }`}
                        >
                          <span>Step {idx + 1}: {cutMode === 'zone' ? `Zone ${idx + 1} (Ink ${idx+1})` : `Reduction ${idx+1}`}</span>
                          {selectedLayerIndex === idx && <Check className="w-4 h-4 text-emerald-500" />}
                        </button>
                      ))}
                    </div>

                    <div className="pt-4 border-t border-neutral-700 mt-2 space-y-3">
                       <div className="flex items-center justify-between bg-neutral-900/50 p-2 rounded-lg border border-neutral-700/50">
                           <span className="text-xs text-neutral-400">Cut Strategy</span>
                           <div className="flex bg-neutral-800 rounded p-0.5">
                               <button 
                                onClick={() => setCutMode('stack')}
                                className={`p-1.5 rounded text-xs transition-colors ${cutMode === 'stack' ? 'bg-neutral-600 text-white shadow' : 'text-neutral-400 hover:text-neutral-300'}`}
                                title="Reduction Print (Cumulative)"
                               >
                                   <Layers className="w-3.5 h-3.5" />
                               </button>
                               <button 
                                onClick={() => setCutMode('zone')}
                                className={`p-1.5 rounded text-xs transition-colors ${cutMode === 'zone' ? 'bg-neutral-600 text-white shadow' : 'text-neutral-400 hover:text-neutral-300'}`}
                                title="Isolated Zones (Multi-block)"
                               >
                                   <Puzzle className="w-3.5 h-3.5" />
                               </button>
                           </div>
                       </div>
                       
                       <button 
                         onClick={() => setInverted(!inverted)}
                         className="w-full flex items-center justify-between text-xs text-neutral-400 hover:text-neutral-200 px-2"
                       >
                         <span>{inverted ? "Invert: White on Black" : "Standard: Black on White"}</span>
                         {inverted ? <EyeOff className="w-3.5 h-3.5"/> : <Eye className="w-3.5 h-3.5"/>}
                       </button>
                    </div>
                  </div>
                )}
             </div>

          </div>
        </aside>

        {/* Main Canvas Area */}
        <main className="flex-1 bg-neutral-950 relative flex items-center justify-center p-8 overflow-hidden select-none">
          {!image && (
             <div className="text-center space-y-4 max-w-md mx-auto">
               <div className="w-20 h-20 bg-neutral-900 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-emerald-900/20">
                 <Layers className="w-10 h-10 text-emerald-500 opacity-80" />
               </div>
               <h2 className="text-3xl font-bold text-white tracking-tight">Ready to create?</h2>
               <p className="text-neutral-400 leading-relaxed">
                 Upload a photo to generate lino-cut reduction layers. 
                 We'll separate your image into tonal bands so you can plan your carving perfectly.
               </p>
               <button 
                 onClick={() => fileInputRef.current?.click()}
                 className="bg-emerald-600 hover:bg-emerald-500 text-white px-8 py-3 rounded-full font-medium transition-all transform hover:scale-105 shadow-lg shadow-emerald-900/50"
               >
                 Upload Image
               </button>
             </div>
          )}

          <div className={`relative shadow-2xl ${!image ? 'hidden' : 'block'}`}>
            <canvas 
              ref={canvasRef} 
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              className={`max-w-full max-h-[85vh] object-contain rounded-sm border-4 border-white bg-white ${isCropping ? 'cursor-crosshair' : ''}`}
              style={{
                imageRendering: 'pixelated'
              }}
            />
            {isCropping && (
                <div className="absolute top-4 left-4 bg-emerald-900/90 text-white text-xs px-3 py-1.5 rounded-full backdrop-blur-md pointer-events-none border border-emerald-500/50 flex items-center space-x-2">
                    <Crop className="w-3 h-3" />
                    <span>Click and drag to crop</span>
                </div>
            )}
            {!isCropping && activeTab === 'layers' && (
              <div className="absolute top-4 left-4 bg-black/80 text-white text-xs px-3 py-1.5 rounded-full backdrop-blur-md pointer-events-none border border-white/20">
                 {cutMode === 'zone' ? (
                     <span>Zone {selectedLayerIndex + 1}: Isolated Ink Area</span>
                 ) : (
                     <span>Step {selectedLayerIndex + 1}: {inverted ? 'Carve the WHITE areas' : 'Carve the WHITE areas (Keep Black)'}</span>
                 )}
              </div>
            )}
            {!isCropping && activeTab === 'composite' && (
              <div className="absolute top-4 left-4 bg-black/80 text-white text-xs px-3 py-1.5 rounded-full backdrop-blur-md pointer-events-none border border-white/20">
                 Preview ({layerCount} layers)
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}