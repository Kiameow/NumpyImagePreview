import * as fs from 'fs';

// NumPy dtype mapping
const NUMPY_DTYPES = {
    // Floating point types
    '<f4': { name: 'float32', size: 4, type: 'float' },
    '<f8': { name: 'float64', size: 8, type: 'float' },
    '>f4': { name: 'float32_be', size: 4, type: 'float', endian: 'big' },
    '>f8': { name: 'float64_be', size: 8, type: 'float', endian: 'big' },

    // Signed integers
    '<i1': { name: 'int8', size: 1, type: 'integer' },
    '<i2': { name: 'int16', size: 2, type: 'integer' },
    '<i4': { name: 'int32', size: 4, type: 'integer' },
    '<i8': { name: 'int64', size: 8, type: 'integer' },
    '>i1': { name: 'int8_be', size: 1, type: 'integer', endian: 'big' },
    '>i2': { name: 'int16_be', size: 2, type: 'integer', endian: 'big' },
    '>i4': { name: 'int32_be', size: 4, type: 'integer', endian: 'big' },
    '>i8': { name: 'int64_be', size: 8, type: 'integer', endian: 'big' },

    // Unsigned integers
    '|u1': { name: 'uint8', size: 1, type: 'unsigned integer' },
    '<u2': { name: 'uint16', size: 2, type: 'unsigned integer' },
    '<u4': { name: 'uint32', size: 4, type: 'unsigned integer' },
    '<u8': { name: 'uint64', size: 8, type: 'unsigned integer' },
    '>u2': { name: 'uint16_be', size: 2, type: 'unsigned integer', endian: 'big' },
    '>u4': { name: 'uint32_be', size: 4, type: 'unsigned integer', endian: 'big' },
    '>u8': { name: 'uint64_be', size: 8, type: 'unsigned integer', endian: 'big' },

    // Boolean
    '|b1': { name: 'bool', size: 1, type: 'boolean' },

    // Complex types
    '<c8': { name: 'complex64', size: 8, type: 'complex', subtype: 'float32' },
    '<c16': { name: 'complex128', size: 16, type: 'complex', subtype: 'float64' },
    '>c8': { name: 'complex64_be', size: 8, type: 'complex', subtype: 'float32', endian: 'big' },
    '>c16': { name: 'complex128_be', size: 16, type: 'complex', subtype: 'float64', endian: 'big' },

    // String (basic support)
    '|S1': { name: 'string', type: 'string', variable: true }
};

export class NpyFileParser {
    /**
     * Parse a .npy file and return its contents
     * @param filePath Path to the .npy file
     * @returns Parsed array information
     */
    static parseNpyFile(filePath: string): any {
        try {
            // Read the entire file
            const buffer = fs.readFileSync(filePath);

            // Check magic number
            if (buffer[0] !== 0x93 || 
                buffer[1] !== 0x4E || 
                buffer[2] !== 0x55 || 
                buffer[3] !== 0x4D || 
                buffer[4] !== 0x50 || 
                buffer[5] !== 0x59) {
                throw new Error('Invalid NPY file: Incorrect magic number');
            }

            // Parse header
            const headerLength = buffer.readUInt16LE(8);
            console.log('Header length:', headerLength);
            const headerStr = buffer.toString('ascii', 10, 10 + headerLength);
            console.log('Header string:', headerStr);
            
            // Parse header dictionary
            const headerDict = this.parseHeaderDict(headerStr);

            // Determine data type and shape
            const descr = headerDict['descr'];
            const shape = headerDict['shape'];
            const fortranOrder = headerDict['fortran_order'];

            // Find dtype information
            const dtypeInfo = NUMPY_DTYPES[descr as keyof typeof NUMPY_DTYPES];
            if (!dtypeInfo) {
                throw new Error(`Unsupported data type: ${descr}`);
            }

            // Extract data
            const dataOffset = 10 + headerLength;
            const data = this.extractDataToFlatArray(
                buffer,
                dataOffset,
                dtypeInfo, 
                shape
            );

            return {
                dtype: dtypeInfo.name,
                shape: shape,
                data: data
            };
        } catch (error) {
            console.error('Error parsing NPY file:', error);
            throw error;
        }
    }

    /**
     * Parse the header dictionary from the NPY file
     * @param headerStr Header string from the NPY file
     * @returns Parsed header dictionary
     */
    private static parseHeaderDict(headerStr: string): any {
        try {
            // Log the raw header string for debugging
            console.log('Raw header string:', headerStr);
    
            // Ensure headerStr is a string and not undefined
            if (typeof headerStr !== 'string') {
                throw new Error('Header is not a string');
            }
    
            // More robust header parsing
            // NumPy uses a specific header format with a dict-like structure
            // It's typically in the format: {'descr': '<f4', 'fortran_order': False, 'shape': (10,), }
    
            // Remove any leading/trailing whitespace and newlines
            headerStr = headerStr.trim();
    
            // Ensure it starts and ends with braces
            if (!headerStr.startsWith('{') || !headerStr.endsWith('}')) {
                throw new Error('Invalid header format');
            }
    
            // Remove outer braces and trim
            const cleanStr = headerStr.slice(1, -1).trim();
    
            const dict: any = {};
            
            // Split by comma, but be careful with nested structures
            const pairs = this.splitHeaderPairs(cleanStr);
    
            pairs.forEach(pair => {
                const [rawKey, rawValue] = pair.split(':').map(p => p.trim());
                const key = rawKey.replace(/^['"]|['"]$/g, '');
                const value = rawValue.trim();
    
                // Parse different value types
                if (value.startsWith("'") || value.startsWith('"')) {
                    // String value
                    dict[key] = value.slice(1, -1);
                } else if (value === 'True') {
                    dict[key] = true;
                } else if (value === 'False') {
                    dict[key] = false;
                } else if (value.startsWith('(') && value.endsWith(')')) {
                    // Shape parsing - handle single and multi-dimensional shapes
                    const shapeStr = value.slice(1, -1).trim();
                    dict[key] = shapeStr 
                        ? shapeStr.split(',')
                            .map(dim => dim.trim())
                            .filter(dim => dim !== '')
                            .map(Number)
                        : [];
                } else {
                    // Numeric or other value
                    dict[key] = value;
                }
            });
    
            return dict;
        } catch (error) {
            console.error('Error parsing header:', error);
            throw error;
        }
    }

    /**
     * Custom splitting method to handle nested structures
     */
    private static splitHeaderPairs(str: string): string[] {
        const pairs: string[] = [];
        let currentPair = '';
        let parenthesesLevel = 0;
        let inQuotes = false;
        let quoteChar = '';

        for (let char of str) {
            if (!inQuotes) {
                if (char === '"' || char === "'") {
                    inQuotes = true;
                    quoteChar = char;
                } else if (char === '(') {
                    parenthesesLevel++;
                } else if (char === ')') {
                    parenthesesLevel--;
                }
            } else {
                if (char === quoteChar && str[str.indexOf(char) - 1] !== '\\') {
                    inQuotes = false;
                    quoteChar = '';
                }
            }

            if (char === ',' && parenthesesLevel === 0 && !inQuotes) {
                pairs.push(currentPair.trim());
                currentPair = '';
            } else {
                currentPair += char;
            }
        }

        if (currentPair.trim()) {
            pairs.push(currentPair.trim());
        }

        return pairs;
    }

    /**
     * Extract numeric data from the buffer
     * @param buffer Data buffer
     * @param dtypeInfo Data type information
     * @param shape Array shape
     * @param fortranOrder Whether the array is in Fortran order
     * @returns Extracted data as a nested array
     */
    private static extractDataToFlatArray(
        buffer: Buffer, 
        offset: number,
        dtypeInfo: any, 
        shape: number[]
    ): any {
        const totalElements = shape.reduce((a, b) => a * b, 1);
        
        // Slice the buffer to the data section
        // Note: We use .subarray() to create a view, then .slice() to ensure memory alignment 
        // and detach it from the original file buffer to let GC clean up the file buffer if needed.
        // Copying the slice is safer for TypedArray alignment requirements (e.g. Float32 must start at multiple of 4).
        const rawDataBuffer = buffer.subarray(offset).buffer.slice(buffer.byteOffset + offset);

        const isLittleEndianSystem = true; // Node.js/V8 is almost always LE
        const isLittleEndianFile = dtypeInfo.endian !== 'big'; // Default is little ('<') or 'pipe' ('|')

        // 1. FAST PATH: Direct TypedArray mapping
        // If the file endianness matches system endianness (usually true), we don't need to loop.
        if (isLittleEndianSystem === isLittleEndianFile) {
            switch (dtypeInfo.name) {
                case 'float32': return new Float32Array(rawDataBuffer);
                case 'float64': return new Float64Array(rawDataBuffer);
                case 'int8':    return new Int8Array(rawDataBuffer);
                case 'int16':   return new Int16Array(rawDataBuffer);
                case 'int32':   return new Int32Array(rawDataBuffer);
                case 'uint8':   return new Uint8Array(rawDataBuffer);
                case 'uint16':  return new Uint16Array(rawDataBuffer);
                case 'uint32':  return new Uint32Array(rawDataBuffer);
                // BigInt support (modern browsers/node support this)
                case 'int64':   return new BigInt64Array(rawDataBuffer);
                case 'uint64':  return new BigUint64Array(rawDataBuffer);
                case 'bool':    return new Uint8Array(rawDataBuffer); // Represent bool as bytes
            }
        }

        // 2. SLOW PATH: Endianness mismatch or Complex numbers
        // If we have Big Endian data on Little Endian CPU, or Complex numbers, we fall back to DataView loops.
        // This effectively copies your old extractDataToFlatArray logic but returns TypedArrays where possible.
        
        const view = new DataView(rawDataBuffer);
        
        // Helper to create the right array type
        let result: any;
        
        switch(dtypeInfo.name) {
             // Floats (Big Endian fallback)
            case 'float32_be': 
                result = new Float32Array(totalElements);
                for(let i=0; i<totalElements; i++) {result[i] = view.getFloat32(i*4, false);} // false = Big Endian
                return result;
            case 'float64_be': 
                result = new Float64Array(totalElements);
                for(let i=0; i<totalElements; i++) {result[i] = view.getFloat64(i*8, false);}
                return result;
            
            // Integers (Big Endian fallback)
            case 'int16_be':
                result = new Int16Array(totalElements);
                for(let i=0; i<totalElements; i++) {result[i] = view.getInt16(i*2, false);}
                return result;
            case 'int32_be':
                result = new Int32Array(totalElements);
                for(let i=0; i<totalElements; i++) {result[i] = view.getInt32(i*4, false);}
                return result;
                
            // Complex Numbers (Must remain standard Arrays of objects, TypedArrays don't support objects)
            case 'complex64':
            case 'complex64_be':
                const isLE64 = dtypeInfo.name === 'complex64';
                result = new Array(totalElements);
                for (let i = 0; i < totalElements; i++) {
                    result[i] = {
                        real: view.getFloat32(i * 8, isLE64),
                        imag: view.getFloat32(i * 8 + 4, isLE64)
                    };
                }
                return result;

            // ... You can add other Big Endian fallbacks here if needed ...
            
            default:
                throw new Error(`Unsupported dtype: ${dtypeInfo.name}`);
        }
    }

    /**
     * Reshape a flat array into a multi-dimensional array
     * @param flatArray Flat input array
     * @param shape Desired shape
     * @param fortranOrder Whether to use Fortran (column-major) order
     * @returns Reshaped array
     */
    private static reshapeArray(
        flatArray: any[], 
        shape: number[], 
        fortranOrder: boolean
    ): any[] {
        if (shape.length === 0) {
            return flatArray[0];
        }

        if (shape.length === 1) {
            return flatArray;
        }

        const result: any[] = [];
        const dimensions = shape.length;
        const sizes = shape.slice().reverse();

        if (fortranOrder) {
            // Column-major (Fortran) order
            for (let i = 0; i < sizes[0]; i++) {
                let subArray: any[] = flatArray.slice(i * sizes[1], (i + 1) * sizes[1]);
                
                for (let j = 1; j < dimensions; j++) {
                    subArray = this.chunkArray(subArray, sizes[j]);
                }
                
                result.push(subArray);
            }
        } else {
            // Row-major (C) order
            for (let i = 0; i < sizes[dimensions - 1]; i++) {
                let subArray: any[] = flatArray.slice(i * sizes[dimensions - 2], (i + 1) * sizes[dimensions - 2]);
                
                for (let j = dimensions - 2; j > 0; j--) {
                    subArray = this.chunkArray(subArray, sizes[j]);
                }
                
                result.push(subArray);
            }
        }

        return result;
    }

    /**
     * Chunk an array into sub-arrays of specified size
     * @param array Input array
     * @param size Chunk size
     * @returns Chunked array
     */
    private static chunkArray(array: any[], size: number): any[] {
        const result: any[] = [];
        for (let i = 0; i < array.length; i += size) {
            result.push(array.slice(i, i + size));
        }
        return result;
    }
}
