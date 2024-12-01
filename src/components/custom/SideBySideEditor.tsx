import { useState, useEffect, useCallback } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { XMLParser, XMLBuilder } from 'fast-xml-parser'
import yaml from 'js-yaml'
import Papa from 'papaparse'
import { WidthIcon } from '@radix-ui/react-icons'

const formatOptions = [
  { value: 'json', label: 'JSON' },
  { value: 'xml', label: 'XML' },
  { value: 'yaml', label: 'YAML' },
  { value: 'csv', label: 'CSV' },
  { value: 'text', label: 'Plain Text' },
  { value: 'base64', label: 'Base64' },
  { value: 'hex', label: 'Hexadecimal' },
  { value: 'binary', label: 'Binary' },
  { value: 'uri', label: 'URI Encoded' },
]

type IntermediateState = {
  type: 'primitive' | 'array' | 'object';
  value: any;
};

export default function SideBySideEditor() {
  const [inputText, setInputText] = useState('')
  const [outputText, setOutputText] = useState('')
  const [inputFormat, setInputFormat] = useState('text')
  const [outputFormat, setOutputFormat] = useState('text')
  // const [intermediateState, setIntermediateState] = useState<IntermediateState | null>(null)

  const parseInput = useCallback((text: string, format: string): IntermediateState => {
    try {
      let parsed: any;
      switch (format) {
        case 'json':
          parsed = JSON.parse(text);
          break;
        case 'xml':
          parsed = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_",
            textNodeName: "#text",
          }).parse(text);
          break;
        case 'yaml':
          parsed = yaml.load(text);
          break;
        case 'csv':
          parsed = Papa.parse(text, { header: true }).data;
          break;
        case 'base64':
          const decodedText = atob(text);
          try {
            parsed = JSON.parse(decodedText);
          } catch {
            parsed = decodedText;
          }
          break;
        case 'hex':
          parsed = text.match(/.{1,2}/g)?.map(byte => String.fromCharCode(parseInt(byte, 16))).join('');
          try {
            parsed = JSON.parse(parsed);
          } catch {
            // If it's not valid JSON, keep it as a string
          }
          break;
        case 'binary':
          parsed = text.replace(/\s/g, '').match(/.{1,8}/g)?.map(byte => String.fromCharCode(parseInt(byte, 2))).join('');
          try {
            parsed = JSON.parse(parsed);
          } catch {
            // If it's not valid JSON, keep it as a string
          }
          break;
        case 'uri':
          parsed = decodeURIComponent(text);
          try {
            parsed = JSON.parse(parsed);
          } catch {
            // If it's not valid JSON, keep it as a string
          }
          break;
        default:
          parsed = text;
      }

      if (Array.isArray(parsed)) {
        return { type: 'array', value: parsed };
      } else if (typeof parsed === 'object' && parsed !== null) {
        return { type: 'object', value: parsed };
      } else {
        return { type: 'primitive', value: parsed };
      }
    } catch (error) {
      console.error(`Error parsing ${format}:`, error);
      return { type: 'primitive', value: `Error: Could not parse ${format}` };
    }
  }, [])

  const stringifyOutput = useCallback((state: IntermediateState, format: string): string => {
    try {
      let result: string;
      switch (format) {
        case 'json':
          result = JSON.stringify(state.value, null, 2);
          break;
        case 'xml':
          const xmlBuilder = new XMLBuilder({
            ignoreAttributes: false,
            format: true,
            attributeNamePrefix: "@_",
            textNodeName: "#text",
          });
          result = xmlBuilder.build(state.type === 'array' ? { root: { item: state.value } } : state.value);
          break;
        case 'yaml':
          result = yaml.dump(state.value);
          break;
        case 'csv':
          result = Papa.unparse(state.type === 'array' ? state.value : [state.value]);
          break;
        case 'base64':
          const stringToEncode = state.type === 'primitive' ? state.value : JSON.stringify(state.value);
          result = btoa(unescape(encodeURIComponent(stringToEncode)));
          break;
        case 'hex':
          const stringToHex = state.type === 'primitive' ? state.value : JSON.stringify(state.value);
          result = stringToHex.split('').map((char: string) => char.charCodeAt(0).toString(16).padStart(2, '0')).join('');
          break;
        case 'binary':
          const stringToBinary = state.type === 'primitive' ? state.value : JSON.stringify(state.value);
          result = stringToBinary.split('').map((char: string) => char.charCodeAt(0).toString(2).padStart(8, '0')).join(' ');
          break;
        case 'uri':
          const stringToUri = state.type === 'primitive' ? state.value : JSON.stringify(state.value);
          result = encodeURIComponent(stringToUri);
          break;
        default:
          result = state.type === 'primitive' ? state.value : JSON.stringify(state.value);
      }
      return result;
    } catch (error) {
      console.error(`Error stringifying to ${format}:`, error);
      return `Error: Could not convert to ${format}`;
    }
  }, [])

  const handleConvert = useCallback(() => {
    const newIntermediateState = parseInput(inputText, inputFormat);
    // setIntermediateState(newIntermediateState);
    const convertedOutput = stringifyOutput(newIntermediateState, outputFormat);
    setOutputText(convertedOutput);
  }, [inputText, inputFormat, outputFormat, parseInput, stringifyOutput])

  useEffect(() => {
    handleConvert();
  }, [handleConvert])

  const handleSwap = () => {
    setInputText(outputText);
    setOutputText(inputText);
    setInputFormat(outputFormat);
    setOutputFormat(inputFormat);
    // setIntermediateState(null);
  }

  return (
    <div className="flex flex-col h-screen">
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex space-x-2">
          <Button onClick={handleSwap}><WidthIcon className="mr-2 h-4 w-4" /> Swap</Button>
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <EditorPane
          value={inputText}
          onChange={setInputText}
          format={inputFormat}
          onFormatChange={setInputFormat}
          readOnly={false}
        />
        <EditorPane
          value={outputText}
          onChange={() => {}}
          format={outputFormat}
          onFormatChange={setOutputFormat}
          readOnly={true}
        />
      </div>
    </div>
  )
}

interface EditorPaneProps {
  value: string
  onChange: (value: string) => void
  format: string
  onFormatChange: (value: string) => void
  readOnly: boolean
}

function EditorPane({ value, onChange, format, onFormatChange, readOnly }: EditorPaneProps) {
  return (
    <div className="flex-1 flex flex-col border-r last:border-r-0">
      <div className="p-2 border-b">
        <Select value={format} onValueChange={onFormatChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {formatOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 resize-none rounded-none border-0 font-mono"
        placeholder={readOnly ? "Output will appear here..." : "Enter your text here..."}
        readOnly={readOnly}
      />
    </div>
  )
}

