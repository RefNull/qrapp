// Client-side QR Code Matrix Generator (Zero dependencies, MIT License)
// Based on Kazuhiko Arase's JIS X 0510:1999 implementation.

const QRMode = {
  MODE_NUMBER: 1 << 0,
  MODE_ALPHA_NUM: 1 << 1,
  MODE_8BIT_BYTE: 1 << 2,
  MODE_KANJI: 1 << 3,
};

const QRErrorCorrectionLevel = {
  L: 1,
  M: 0,
  Q: 3,
  H: 2,
};

const QRMaskPattern = {
  PATTERN000: 0,
  PATTERN001: 1,
  PATTERN010: 2,
  PATTERN011: 3,
  PATTERN100: 4,
  PATTERN101: 5,
  PATTERN110: 6,
  PATTERN111: 7,
};

const QRMath = (() => {
  const EXP_TABLE = new Array(256);
  const LOG_TABLE = new Array(256);
  for (let i = 0; i < 8; i += 1) EXP_TABLE[i] = 1 << i;
  for (let i = 8; i < 256; i += 1) {
    EXP_TABLE[i] = EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
  }
  for (let i = 0; i < 255; i += 1) LOG_TABLE[EXP_TABLE[i]] = i;

  return {
    glog(n) {
      if (n < 1) throw new Error('glog(' + n + ')');
      return LOG_TABLE[n];
    },
    gexp(n) {
      while (n < 0) n += 255;
      while (n >= 256) n -= 255;
      return EXP_TABLE[n];
    },
  };
})();

function qrPolynomial(num, shift) {
  let offset = 0;
  while (offset < num.length && num[offset] === 0) offset += 1;
  const _num = new Array(num.length - offset + shift);
  for (let i = 0; i < num.length - offset; i += 1) _num[i] = num[i + offset];

  return {
    getAt(index) { return _num[index]; },
    getLength() { return _num.length; },
    multiply(e) {
      const result = new Array(this.getLength() + e.getLength() - 1).fill(0);
      for (let i = 0; i < this.getLength(); i += 1) {
        for (let j = 0; j < e.getLength(); j += 1) {
          result[i + j] ^= QRMath.gexp(QRMath.glog(this.getAt(i)) + QRMath.glog(e.getAt(j)));
        }
      }
      return qrPolynomial(result, 0);
    },
    mod(e) {
      if (this.getLength() - e.getLength() < 0) return this;
      const ratio = QRMath.glog(this.getAt(0)) - QRMath.glog(e.getAt(0));
      const result = new Array(this.getLength());
      for (let i = 0; i < this.getLength(); i += 1) result[i] = this.getAt(i);
      for (let i = 0; i < e.getLength(); i += 1) {
        result[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i)) + ratio);
      }
      return qrPolynomial(result, 0).mod(e);
    },
  };
}

const QRRSBlock = (() => {
  const RS_BLOCK_TABLE = [
    [1, 26, 19], [1, 26, 16], [1, 26, 13], [1, 26, 9],
    [1, 44, 34], [1, 44, 28], [1, 44, 22], [1, 44, 16],
    [1, 70, 55], [1, 70, 44], [2, 35, 17], [2, 35, 13],
    [1, 100, 80], [2, 50, 32], [2, 50, 24], [4, 25, 9],
    [1, 134, 108], [2, 67, 43], [2, 33, 15, 2, 34, 16], [2, 33, 11, 2, 34, 12],
    [2, 86, 68], [4, 43, 27], [4, 43, 19], [4, 43, 15],
    [2, 98, 78], [4, 49, 31], [2, 32, 14, 4, 33, 15], [4, 39, 13, 1, 40, 14],
    [2, 121, 97], [2, 60, 38, 2, 61, 39], [4, 40, 18, 2, 41, 19], [4, 40, 14, 2, 41, 15],
    [2, 146, 116], [3, 58, 36, 2, 59, 37], [4, 36, 16, 4, 37, 17], [4, 36, 12, 4, 37, 13],
    [2, 86, 68, 2, 87, 69], [4, 69, 43, 1, 70, 44], [6, 43, 19, 2, 44, 20], [6, 43, 15, 2, 44, 16],
    [4, 101, 81], [1, 80, 50, 4, 81, 51], [4, 50, 22, 4, 51, 23], [3, 36, 12, 8, 37, 13],
    [2, 116, 92, 2, 117, 93], [6, 58, 36, 2, 59, 37], [4, 46, 20, 6, 47, 21], [7, 42, 14, 4, 43, 15],
    [4, 133, 107], [8, 59, 37, 1, 60, 38], [8, 44, 20, 4, 45, 21], [12, 33, 11, 4, 34, 12],
    [3, 145, 115, 1, 146, 116], [4, 64, 40, 5, 65, 41], [11, 36, 16, 5, 37, 17], [11, 36, 12, 5, 37, 13],
    [5, 109, 87, 1, 110, 88], [5, 65, 41, 5, 66, 42], [5, 54, 24, 7, 55, 25], [11, 36, 12, 7, 37, 13],
    [5, 122, 98, 1, 123, 99], [7, 73, 45, 3, 74, 46], [15, 43, 19, 2, 44, 20], [3, 45, 15, 13, 46, 16],
    [1, 135, 107, 5, 136, 108], [10, 74, 46, 1, 75, 47], [1, 50, 22, 15, 51, 23], [2, 42, 14, 17, 43, 15],
    [5, 150, 120, 1, 151, 121], [9, 69, 43, 4, 70, 44], [17, 50, 22, 1, 51, 23], [2, 42, 14, 19, 43, 15],
    [3, 141, 113, 4, 142, 114], [3, 70, 44, 11, 71, 45], [17, 47, 21, 4, 48, 22], [9, 39, 13, 16, 40, 14],
    [3, 135, 107, 5, 136, 108], [3, 67, 41, 13, 68, 42], [15, 54, 24, 5, 55, 25], [15, 43, 15, 10, 44, 16]
  ];

  function getRsBlockTable(typeNumber, errorCorrectionLevel) {
    switch (errorCorrectionLevel) {
      case QRErrorCorrectionLevel.L: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
      case QRErrorCorrectionLevel.M: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
      case QRErrorCorrectionLevel.Q: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
      case QRErrorCorrectionLevel.H: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
      default: return undefined;
    }
  }

  return {
    getRSBlocks(typeNumber, errorCorrectionLevel) {
      const rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);
      if (!rsBlock) throw new Error('bad rs block @ typeNumber:' + typeNumber + '/errorCorrectionLevel:' + errorCorrectionLevel);
      const length = rsBlock.length / 3;
      const list = [];
      for (let i = 0; i < length; i += 1) {
        const count = rsBlock[i * 3 + 0];
        const totalCount = rsBlock[i * 3 + 1];
        const dataCount = rsBlock[i * 3 + 2];
        for (let j = 0; j < count; j += 1) {
          list.push({ totalCount, dataCount });
        }
      }
      return list;
    },
  };
})();

const QRUtil = (() => {
  const PATTERN_POSITION_TABLE = [
    [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54],
    [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70],
    [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86],
    [6, 34, 62, 90]
  ];
  const G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
  const G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
  const G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

  function getBCHDigit(data) {
    let digit = 0;
    while (data !== 0) {
      digit += 1;
      data >>>= 1;
    }
    return digit;
  }

  return {
    getBCHTypeInfo(data) {
      let d = data << 10;
      while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
        d ^= (G15 << (getBCHDigit(d) - getBCHDigit(G15)));
      }
      return ((data << 10) | d) ^ G15_MASK;
    },
    getBCHTypeNumber(data) {
      let d = data << 12;
      while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
        d ^= (G18 << (getBCHDigit(d) - getBCHDigit(G18)));
      }
      return (data << 12) | d;
    },
    getPatternPosition(typeNumber) {
      return PATTERN_POSITION_TABLE[typeNumber - 1] || [];
    },
    getMaskFunction(maskPattern) {
      switch (maskPattern) {
        case QRMaskPattern.PATTERN000: return (i, j) => (i + j) % 2 === 0;
        case QRMaskPattern.PATTERN001: return (i) => i % 2 === 0;
        case QRMaskPattern.PATTERN010: return (i, j) => j % 3 === 0;
        case QRMaskPattern.PATTERN011: return (i, j) => (i + j) % 3 === 0;
        case QRMaskPattern.PATTERN100: return (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
        case QRMaskPattern.PATTERN101: return (i, j) => (i * j) % 2 + (i * j) % 3 === 0;
        case QRMaskPattern.PATTERN110: return (i, j) => ((i * j) % 2 + (i * j) % 3) % 2 === 0;
        case QRMaskPattern.PATTERN111: return (i, j) => ((i * j) % 3 + (i + j) % 2) % 2 === 0;
        default: throw new Error('bad maskPattern:' + maskPattern);
      }
    },
    getErrorCorrectPolynomial(errorCorrectLength) {
      let a = qrPolynomial([1], 0);
      for (let i = 0; i < errorCorrectLength; i += 1) {
        a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0));
      }
      return a;
    },
    getLengthInBits(mode, type) {
      if (1 <= type && type < 10) {
        switch (mode) {
          case QRMode.MODE_NUMBER: return 10;
          case QRMode.MODE_ALPHA_NUM: return 9;
          case QRMode.MODE_8BIT_BYTE: return 8;
          case QRMode.MODE_KANJI: return 8;
          default: throw new Error('mode:' + mode);
        }
      } else if (type < 27) {
        switch (mode) {
          case QRMode.MODE_NUMBER: return 12;
          case QRMode.MODE_ALPHA_NUM: return 11;
          case QRMode.MODE_8BIT_BYTE: return 16;
          case QRMode.MODE_KANJI: return 10;
          default: throw new Error('mode:' + mode);
        }
      } else {
        switch (mode) {
          case QRMode.MODE_NUMBER: return 14;
          case QRMode.MODE_ALPHA_NUM: return 13;
          case QRMode.MODE_8BIT_BYTE: return 16;
          case QRMode.MODE_KANJI: return 12;
          default: throw new Error('mode:' + mode);
        }
      }
    },
    getLostPoint(qr) {
      const moduleCount = qr.getModuleCount();
      let lostPoint = 0;

      for (let row = 0; row < moduleCount; row += 1) {
        for (let col = 0; col < moduleCount; col += 1) {
          let sameCount = 0;
          const dark = qr.isDark(row, col);
          for (let r = -1; r <= 1; r += 1) {
            if (row + r < 0 || moduleCount <= row + r) continue;
            for (let c = -1; c <= 1; c += 1) {
              if (col + c < 0 || moduleCount <= col + c) continue;
              if (r === 0 && c === 0) continue;
              if (dark === qr.isDark(row + r, col + c)) sameCount += 1;
            }
          }
          if (sameCount > 5) lostPoint += (3 + sameCount - 5);
        }
      }

      for (let row = 0; row < moduleCount - 1; row += 1) {
        for (let col = 0; col < moduleCount - 1; col += 1) {
          let count = 0;
          if (qr.isDark(row, col)) count += 1;
          if (qr.isDark(row + 1, col)) count += 1;
          if (qr.isDark(row, col + 1)) count += 1;
          if (qr.isDark(row + 1, col + 1)) count += 1;
          if (count === 0 || count === 4) lostPoint += 3;
        }
      }

      for (let row = 0; row < moduleCount; row += 1) {
        for (let col = 0; col < moduleCount - 6; col += 1) {
          if (qr.isDark(row, col)
              && !qr.isDark(row, col + 1)
              && qr.isDark(row, col + 2)
              && qr.isDark(row, col + 3)
              && qr.isDark(row, col + 4)
              && !qr.isDark(row, col + 5)
              && qr.isDark(row, col + 6)) {
            lostPoint += 40;
          }
        }
      }

      for (let col = 0; col < moduleCount; col += 1) {
        for (let row = 0; row < moduleCount - 6; row += 1) {
          if (qr.isDark(row, col)
              && !qr.isDark(row + 1, col)
              && qr.isDark(row + 2, col)
              && qr.isDark(row + 3, col)
              && qr.isDark(row + 4, col)
              && !qr.isDark(row + 5, col)
              && qr.isDark(row + 6, col)) {
            lostPoint += 40;
          }
        }
      }

      let darkCount = 0;
      for (let col = 0; col < moduleCount; col += 1) {
        for (let row = 0; row < moduleCount; row += 1) {
          if (qr.isDark(row, col)) darkCount += 1;
        }
      }
      const ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
      lostPoint += ratio * 10;
      return lostPoint;
    },
  };
})();

function qrBitBuffer() {
  const _buffer = [];
  let _length = 0;

  return {
    getBuffer() { return _buffer; },
    getLengthInBits() { return _length; },
    put(num, length) {
      for (let i = 0; i < length; i += 1) {
        this.putBit(((num >>> (length - i - 1)) & 1) === 1);
      }
    },
    putBit(bit) {
      const bufIndex = Math.floor(_length / 8);
      if (_buffer.length <= bufIndex) _buffer.push(0);
      if (bit) _buffer[bufIndex] |= (0x80 >>> (_length % 8));
      _length += 1;
    },
  };
}

function stringToUtf8ByteArray(str) {
  const utf8 = [];
  for (let i = 0; i < str.length; i++) {
    let charcode = str.charCodeAt(i);
    if (charcode < 0x80) {
      utf8.push(charcode);
    } else if (charcode < 0x800) {
      utf8.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
    } else if (charcode < 0xd800 || charcode >= 0xe000) {
      utf8.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
    } else {
      i++;
      charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      utf8.push(
        0xf0 | (charcode >> 18),
        0x80 | ((charcode >> 12) & 0x3f),
        0x80 | ((charcode >> 6) & 0x3f),
        0x80 | (charcode & 0x3f)
      );
    }
  }
  return utf8;
}

function qr8BitByte(data) {
  const _bytes = stringToUtf8ByteArray(data);
  return {
    getMode() { return QRMode.MODE_8BIT_BYTE; },
    getLength() { return _bytes.length; },
    write(buffer) {
      for (let i = 0; i < _bytes.length; i += 1) {
        buffer.put(_bytes[i], 8);
      }
    },
  };
}

export function createQrMatrix(typeNumber, errorCorrectionLevel) {
  const PAD0 = 0xEC;
  const PAD1 = 0x11;

  let _typeNumber = typeNumber;
  const _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel || 'M'];
  let _modules = null;
  let _moduleCount = 0;
  let _dataCache = null;
  const _dataList = [];

  function setupPositionProbePattern(row, col) {
    for (let r = -1; r <= 7; r += 1) {
      if (row + r <= -1 || _moduleCount <= row + r) continue;
      for (let c = -1; c <= 7; c += 1) {
        if (col + c <= -1 || _moduleCount <= col + c) continue;
        if ((0 <= r && r <= 6 && (c === 0 || c === 6))
            || (0 <= c && c <= 6 && (r === 0 || r === 6))
            || (2 <= r && r <= 4 && 2 <= c && c <= 4)) {
          _modules[row + r][col + c] = true;
        } else {
          _modules[row + r][col + c] = false;
        }
      }
    }
  }

  function setupTimingPattern() {
    for (let r = 8; r < _moduleCount - 8; r += 1) {
      if (_modules[r][6] != null) continue;
      _modules[r][6] = (r % 2 === 0);
    }
    for (let c = 8; c < _moduleCount - 8; c += 1) {
      if (_modules[6][c] != null) continue;
      _modules[6][c] = (c % 2 === 0);
    }
  }

  function setupPositionAdjustPattern() {
    const pos = QRUtil.getPatternPosition(_typeNumber);
    for (let i = 0; i < pos.length; i += 1) {
      for (let j = 0; j < pos.length; j += 1) {
        const row = pos[i];
        const col = pos[j];
        if (_modules[row][col] != null) continue;
        for (let r = -2; r <= 2; r += 1) {
          for (let c = -2; c <= 2; c += 1) {
            if (r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0)) {
              _modules[row + r][col + c] = true;
            } else {
              _modules[row + r][col + c] = false;
            }
          }
        }
      }
    }
  }

  function setupTypeNumber(test) {
    const bits = QRUtil.getBCHTypeNumber(_typeNumber);
    for (let i = 0; i < 18; i += 1) {
      _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = (!test && ((bits >> i) & 1) === 1);
    }
    for (let i = 0; i < 18; i += 1) {
      _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = (!test && ((bits >> i) & 1) === 1);
    }
  }

  function setupTypeInfo(test, maskPattern) {
    const data = (_errorCorrectionLevel << 3) | maskPattern;
    const bits = QRUtil.getBCHTypeInfo(data);
    for (let i = 0; i < 15; i += 1) {
      const mod = (!test && ((bits >> i) & 1) === 1);
      if (i < 6) _modules[i][8] = mod;
      else if (i < 8) _modules[i + 1][8] = mod;
      else _modules[_moduleCount - 15 + i][8] = mod;
    }
    for (let i = 0; i < 15; i += 1) {
      const mod = (!test && ((bits >> i) & 1) === 1);
      if (i < 8) _modules[8][_moduleCount - i - 1] = mod;
      else if (i < 9) _modules[8][15 - i - 1 + 1] = mod;
      else _modules[8][15 - i - 1] = mod;
    }
    _modules[_moduleCount - 8][8] = (!test);
  }

  function mapData(data, maskPattern) {
    let inc = -1;
    let row = _moduleCount - 1;
    let bitIndex = 7;
    let byteIndex = 0;
    const maskFunc = QRUtil.getMaskFunction(maskPattern);

    for (let col = _moduleCount - 1; col > 0; col -= 2) {
      if (col === 6) col -= 1;
      while (true) {
        for (let c = 0; c < 2; c += 1) {
          if (_modules[row][col - c] == null) {
            let dark = false;
            if (byteIndex < data.length) {
              dark = (((data[byteIndex] >>> bitIndex) & 1) === 1);
            }
            const mask = maskFunc(row, col - c);
            if (mask) dark = !dark;
            _modules[row][col - c] = dark;
            bitIndex -= 1;
            if (bitIndex === -1) {
              byteIndex += 1;
              bitIndex = 7;
            }
          }
        }
        row += inc;
        if (row < 0 || _moduleCount <= row) {
          row -= inc;
          inc = -inc;
          break;
        }
      }
    }
  }

  function createBytes(buffer, rsBlocks) {
    let offset = 0;
    let maxDcCount = 0;
    let maxEcCount = 0;
    const dcdata = new Array(rsBlocks.length);
    const ecdata = new Array(rsBlocks.length);

    for (let r = 0; r < rsBlocks.length; r += 1) {
      const dcCount = rsBlocks[r].dataCount;
      const ecCount = rsBlocks[r].totalCount - dcCount;
      maxDcCount = Math.max(maxDcCount, dcCount);
      maxEcCount = Math.max(maxEcCount, ecCount);

      dcdata[r] = new Array(dcCount);
      for (let i = 0; i < dcdata[r].length; i += 1) {
        dcdata[r][i] = 0xff & buffer.getBuffer()[i + offset];
      }
      offset += dcCount;

      const rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
      const rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);
      const modPoly = rawPoly.mod(rsPoly);
      ecdata[r] = new Array(rsPoly.getLength() - 1);
      for (let i = 0; i < ecdata[r].length; i += 1) {
        const modIndex = i + modPoly.getLength() - ecdata[r].length;
        ecdata[r][i] = (modIndex >= 0) ? modPoly.getAt(modIndex) : 0;
      }
    }

    let totalCodeCount = 0;
    for (let i = 0; i < rsBlocks.length; i += 1) {
      totalCodeCount += rsBlocks[i].totalCount;
    }

    const data = new Array(totalCodeCount);
    let index = 0;

    for (let i = 0; i < maxDcCount; i += 1) {
      for (let r = 0; r < rsBlocks.length; r += 1) {
        if (i < dcdata[r].length) {
          data[index] = dcdata[r][i];
          index += 1;
        }
      }
    }

    for (let i = 0; i < maxEcCount; i += 1) {
      for (let r = 0; r < rsBlocks.length; r += 1) {
        if (i < ecdata[r].length) {
          data[index] = ecdata[r][i];
          index += 1;
        }
      }
    }

    return data;
  }

  function createData(typeNumber, errorCorrectionLevel, dataList) {
    const rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel);
    const buffer = qrBitBuffer();

    for (let i = 0; i < dataList.length; i += 1) {
      const d = dataList[i];
      buffer.put(d.getMode(), 4);
      buffer.put(d.getLength(), QRUtil.getLengthInBits(d.getMode(), typeNumber));
      d.write(buffer);
    }

    let totalDataCount = 0;
    for (let i = 0; i < rsBlocks.length; i += 1) {
      totalDataCount += rsBlocks[i].dataCount;
    }

    if (buffer.getLengthInBits() > totalDataCount * 8) {
      throw new Error('Code length overflow: ' + buffer.getLengthInBits() + ' > ' + (totalDataCount * 8));
    }

    if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
      buffer.put(0, 4);
    }

    while (buffer.getLengthInBits() % 8 !== 0) {
      buffer.putBit(false);
    }

    while (true) {
      if (buffer.getLengthInBits() >= totalDataCount * 8) break;
      buffer.put(PAD0, 8);
      if (buffer.getLengthInBits() >= totalDataCount * 8) break;
      buffer.put(PAD1, 8);
    }

    return createBytes(buffer, rsBlocks);
  }

  function makeImpl(test, maskPattern) {
    _moduleCount = _typeNumber * 4 + 17;
    _modules = Array.from({ length: _moduleCount }, () => new Array(_moduleCount).fill(null));

    setupPositionProbePattern(0, 0);
    setupPositionProbePattern(_moduleCount - 7, 0);
    setupPositionProbePattern(0, _moduleCount - 7);
    setupPositionAdjustPattern();
    setupTimingPattern();
    setupTypeInfo(test, maskPattern);

    if (_typeNumber >= 7) {
      setupTypeNumber(test);
    }

    if (_dataCache == null) {
      _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
    }

    mapData(_dataCache, maskPattern);
  }

  function getBestMaskPattern() {
    let minLostPoint = 0;
    let pattern = 0;
    for (let i = 0; i < 8; i += 1) {
      makeImpl(true, i);
      const lostPoint = QRUtil.getLostPoint(api);
      if (i === 0 || minLostPoint > lostPoint) {
        minLostPoint = lostPoint;
        pattern = i;
      }
    }
    return pattern;
  }

  const api = {
    addData(data) {
      _dataList.push(qr8BitByte(data));
      _dataCache = null;
    },
    isDark(row, col) {
      if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
        throw new Error(row + ',' + col);
      }
      return _modules[row][col];
    },
    getModuleCount() {
      return _moduleCount;
    },
    make() {
      if (_typeNumber < 1) {
        let typeNumber = 1;
        for (; typeNumber < 20; typeNumber++) {
          const rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel);
          const buffer = qrBitBuffer();
          for (let i = 0; i < _dataList.length; i++) {
            const d = _dataList[i];
            buffer.put(d.getMode(), 4);
            buffer.put(d.getLength(), QRUtil.getLengthInBits(d.getMode(), typeNumber));
            d.write(buffer);
          }
          let totalDataCount = 0;
          for (let i = 0; i < rsBlocks.length; i++) {
            totalDataCount += rsBlocks[i].dataCount;
          }
          if (buffer.getLengthInBits() <= totalDataCount * 8) {
            break;
          }
        }
        _typeNumber = typeNumber;
      }
      makeImpl(false, getBestMaskPattern());
    },
  };

  return api;
}

export function generateQrMatrix(text, options = {}) {
  const ecc = options.ecc || 'M';
  const qr = createQrMatrix(0, ecc);
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const matrix = [];
  for (let r = 0; r < count; r++) {
    const row = [];
    for (let c = 0; c < count; c++) {
      row.push(qr.isDark(r, c));
    }
    matrix.push(row);
  }
  return matrix;
}

export function renderQrToCanvas(canvas, text, options = {}) {
  const ecc = options.ecc || 'M';
  const qr = createQrMatrix(0, ecc);
  qr.addData(text);
  qr.make();

  const moduleCount = qr.getModuleCount();
  const margin = options.margin !== undefined ? options.margin : 2;
  const size = options.size || canvas.width || 200;
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  const cellSize = size / (moduleCount + margin * 2);

  ctx.fillStyle = options.bgColor || '#ffffff';
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = options.fgColor || '#0b0d12';
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (qr.isDark(row, col)) {
        ctx.fillRect(
          Math.floor((col + margin) * cellSize),
          Math.floor((row + margin) * cellSize),
          Math.ceil(cellSize),
          Math.ceil(cellSize)
        );
      }
    }
  }

  return canvas;
}
