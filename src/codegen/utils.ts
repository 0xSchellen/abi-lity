import { findIndex } from "lodash";
import {
  assert,
  ASTNodeFactory,
  DataLocation,
  Expression,
  FunctionCallKind,
  Identifier,
  SourceUnit,
  YulExpression,
  YulIdentifier
} from "solc-typed-ast";
import { ArrayType, StructType, TupleType, TypeNode } from "../ast";
import {
  CompileHelper,
  findFunctionDefinition,
  getConstant,
  getInclusiveRangeWith,
  getYulConstant,
  StructuredText,
  toHex,
  writeNestedStructure
} from "../utils";

const PointerLibraries = require("./PointerLibraries.json");

export class CodegenContext {
  constructor(public helper: CompileHelper, public decoderSourceUnitName: string) {
    this.helper.addSourceUnit("PointerLibraries.sol", writeNestedStructure(PointerLibraries));
    this.helper.addSourceUnit(decoderSourceUnitName);
    this.helper.addImport(decoderSourceUnitName, "PointerLibraries.sol");
  }

  get decoderSourceUnit(): SourceUnit {
    return this.helper.getSourceUnit(this.decoderSourceUnitName);
  }

  getConstant(name: string, value: number | string): Identifier {
    return getConstant(this.decoderSourceUnit, name, value);
  }

  addConstant(name: string, value: number | string): string {
    return this.getConstant(name, value).name;
  }

  getYulConstant(name: string, value: number | string): YulIdentifier {
    return getYulConstant(this.decoderSourceUnit, name, value);
  }

  hasFunction(name: string): boolean {
    return Boolean(findFunctionDefinition(this.decoderSourceUnit, name));
  }

  addFunction(name: string, code: StructuredText): string {
    this.helper.addFunctionCode(this.decoderSourceUnitName, writeNestedStructure(code), name);
    return name;
  }
}
const PointerRoundUp32Mask = `0xffffe0`;

export function roundUpAdd32(ctx: CodegenContext, value: string): string;
export function roundUpAdd32(ctx: SourceUnit, value: YulExpression): YulExpression;
export function roundUpAdd32(
  ctx: SourceUnit | CodegenContext,
  value: YulExpression | string
): string | YulExpression {
  if (ctx instanceof CodegenContext && typeof value === "string") {
    return `and(add(${value}, ${ctx.addConstant("AlmostTwoWords", toHex(63))}), ${ctx.addConstant(
      "OnlyFullWordMask",
      PointerRoundUp32Mask
    )})`;
  } else if (ctx instanceof SourceUnit && value instanceof YulExpression) {
    const mask = getYulConstant(ctx, `OnlyFullWordMask`, PointerRoundUp32Mask);
    const almostTwoWords = getYulConstant(ctx, `AlmostTwoWords`, toHex(63));
    return value.add(almostTwoWords).and(mask);
  }
  throw Error(`Unsupported input types`);
}

export function getCalldataDecodingFunction(
  fnName: string,
  inPtr: string,
  outPtr: string,
  body: StructuredText[]
): StructuredText[] {
  return [
    `function ${fnName}(CalldataPointer ${inPtr}) pure returns (MemoryPointer ${outPtr}) {`,
    body,
    `}`
  ];
}

export function canDeriveSizeInOneStep(type: TypeNode): boolean {
  return type.totalNestedDynamicTypes < 2 && type.totalNestedReferenceTypes < 2;
}

export function canCombineTailCopies(type: TypeNode): boolean {
  // Has to be one of:
  // Struct with no embedded reference types
  // Array of value types
  // bytes or string
  // value type
  return type.totalNestedDynamicTypes < 2 && type.totalNestedReferenceTypes < 2;
}

export function abiEncodingMatchesMemoryLayout(type: TypeNode): boolean {
  return type.totalNestedDynamicTypes < 2 && type.totalNestedReferenceTypes < 2;
}

export function getSequentiallyCopyableSegments(struct: StructType): TypeNode[][] {
  const types = struct.vMembers;
  const firstValueIndex = findIndex(types, (t) => t.isValueType);
  if (firstValueIndex < 0) return [];
  const segments: TypeNode[][] = [];
  let currentSegment: TypeNode[] = [];
  let numDynamic = 0;
  const endSegment = () => {
    if (currentSegment.length) {
      const filtered = getInclusiveRangeWith(currentSegment, (t) => t.isValueType);
      // Sanity check: all types in segment are sequential in calldata/memory
      for (let i = 1; i < filtered.length; i++) {
        const { calldataHeadOffset: cdHead, memoryHeadOffset: mHead } = filtered[i];
        const { calldataHeadOffset: cdHeadLast, memoryHeadOffset: mHeadLast } = filtered[i - 1];
        assert(
          cdHeadLast + 32 === cdHead,
          `Got non-sequential calldata heads: [${i - 1}] = ${cdHeadLast}, [${i}] = ${cdHead}`
        );
        assert(
          mHeadLast + 32 === mHead,
          `Got non-sequential memory heads: [${i - 1}] = ${mHeadLast}, [${i}] = ${mHead}`
        );
      }
      segments.push(filtered);
      currentSegment = [];
    }
    numDynamic = 0;
  };
  for (let i = firstValueIndex; i < types.length; i++) {
    const type = types[i];
    if (type.calldataHeadSize !== 32 || (type.isReferenceType && ++numDynamic > 4)) {
      endSegment();
      continue;
    }
    if (type.isValueType) {
      numDynamic = 0;
    }
    currentSegment.push(type);
    if (i === types.length - 1) {
      endSegment();
    }
  }
  return segments;
}

function convertToTuple(node: ArrayType) {
  if (node.isDynamicallySized) {
    throw Error(`Can not convert dynamic length array to tuple ${node.pp()}`);
  }
  const length = node.length as number;
  const members = new Array(length).fill(null).map((_, i) => {
    const name = (node.labelFromParent ?? node.identifier).concat(i.toString());
    const base = node.baseType.copy();
    base.labelFromParent = name;
    return base;
  });

  if (node.parent) {
    node.parent.replaceChild(node, ...members);
    return node.parent;
  } else {
    return new TupleType(members);
  }
}

export function convertFixedLengthArraysToTuples<T extends ArrayType | StructType | TupleType>(
  type: T
): TypeNode {
  type.walkChildren((node) => {
    if (node instanceof ArrayType && !node.isDynamicallySized) {
      convertToTuple(node);
    }
  });
  if (type instanceof ArrayType && !type.isDynamicallySized) {
    return convertToTuple(type);
  }
  return type;
}

export function getPointerOffsetExpression(
  factory: ASTNodeFactory,
  ptr: Expression,
  type: TypeNode,
  location: DataLocation
): Expression {
  const fnName =
    location === DataLocation.CallData && type.isDynamicallyEncoded ? "pptr" : "offset";
  const offsetFunction = factory.makeMemberAccess("tuple(uint256)", ptr, fnName, -1);
  const headOffset =
    location === DataLocation.CallData ? type.calldataHeadOffset : type.memoryHeadOffset;
  if (headOffset === 0) {
    if (fnName === "pptr") {
      return factory.makeFunctionCall("", FunctionCallKind.FunctionCall, offsetFunction, []);
    }
    return ptr;
  }
  const offsetLiteral = factory.makeLiteralUint256(
    location === DataLocation.CallData ? type.calldataHeadOffset : type.memoryHeadOffset
  );
  const offsetCall = factory.makeFunctionCall("", FunctionCallKind.FunctionCall, offsetFunction, [
    offsetLiteral
  ]);
  return offsetCall;
}
