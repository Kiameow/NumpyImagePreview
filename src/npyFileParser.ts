import * as fs from 'fs';
import * as path from 'path';

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
            const dataStart = 10 + headerLength;
            const data = this.extractDataToFlatArray(
                buffer.slice(dataStart), 
                dtypeInfo, 
                shape, 
                fortranOrder
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
        dtypeInfo: any, 
        shape: number[], 
        fortranOrder: boolean
    ): any[] {
        const totalElements = shape.reduce((a, b) => a * b, 1);
        const result: any[] = new Array(totalElements);

        // Read data based on dtype
        for (let i = 0; i < totalElements; i++) {
            const offset = i * dtypeInfo.size;
            
            switch (dtypeInfo.name) {
                // Floating point types
                case 'float32':
                    result[i] = buffer.readFloatLE(offset);
                    break;
                case 'float32_be':
                    result[i] = buffer.readFloatBE(offset);
                    break;
                case 'float64':
                    result[i] = buffer.readDoubleLE(offset);
                    break;
                case 'float64_be':
                    result[i] = buffer.readDoubleBE(offset);
                    break;

                // Signed integers
                case 'int8':
                    result[i] = buffer.readInt8(offset);
                    break;
                case 'int16':
                    result[i] = buffer.readInt16LE(offset);
                    break;
                case 'int16_be':
                    result[i] = buffer.readInt16BE(offset);
                    break;
                case 'int32':
                    result[i] = buffer.readInt32LE(offset);
                    break;
                case 'int32_be':
                    result[i] = buffer.readInt32BE(offset);
                    break;
                case 'int64':
                    result[i] = buffer.readBigInt64LE(offset);
                    break;
                case 'int64_be':
                    result[i] = buffer.readBigInt64BE(offset);
                    break;

                // Unsigned integers
                case 'uint8':
                    result[i] = buffer.readUint8(offset);
                    break;
                case 'uint16':
                    result[i] = buffer.readUint16LE(offset);
                    break;
                case 'uint16_be':
                    result[i] = buffer.readUint16BE(offset);
                    break;
                case 'uint32':
                    result[i] = buffer.readUInt32LE(offset);
                    break;
                case 'uint32_be':
                    result[i] = buffer.readUInt32BE(offset);
                    break;
                case 'uint64':
                    result[i] = buffer.readBigUInt64LE(offset);
                    break;
                case 'uint64_be':
                    result[i] = buffer.readBigUInt64BE(offset);
                    break;

                // Boolean
                case 'bool':
                    result[i] = buffer.readUint8(offset) !== 0;
                    break;

                // Complex types
                case 'complex64':
                    result[i] = {
                        real: buffer.readFloatLE(offset),
                        imag: buffer.readFloatLE(offset + 4)
                    };
                    break;
                case 'complex64_be':
                    result[i] = {
                        real: buffer.readFloatBE(offset),
                        imag: buffer.readFloatBE(offset + 4)
                    };
                    break;
                case 'complex128':
                    result[i] = {
                        real: buffer.readDoubleLE(offset),
                        imag: buffer.readDoubleLE(offset + 8)
                    };
                    break;
                case 'complex128_be':
                    result[i] = {
                        real: buffer.readDoubleBE(offset),
                        imag: buffer.readDoubleBE(offset + 8)
                    };
                    break;

                // String (basic support)
                case 'string':
                    // Assuming fixed-length string, might need more sophisticated parsing
                    result[i] = buffer.toString('utf8', offset, offset + 1);
                    break;

                default:
                    throw new Error(`Unsupported dtype: ${dtypeInfo.name}`);
            }
        }
        return result;
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
