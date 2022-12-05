pragma solidity ^0.8.13;

import { ConduitControllerInterface } from "../interfaces/ConduitControllerInterface.sol";
import { ConsiderationEventsAndErrors } from "../interfaces/ConsiderationEventsAndErrors.sol";
import "./ConsiderationConstants.sol";

/// @title ConsiderationBase
///   @author 0age
///   @notice ConsiderationBase contains immutable constants and constructor logic.
contract ConsiderationBase is ConsiderationEventsAndErrors {
  bytes32 internal immutable _NAME_HASH;
  bytes32 internal immutable _VERSION_HASH;
  bytes32 internal immutable _EIP_712_DOMAIN_TYPEHASH;
  bytes32 internal immutable _OFFER_ITEM_TYPEHASH;
  bytes32 internal immutable _CONSIDERATION_ITEM_TYPEHASH;
  bytes32 internal immutable _ORDER_TYPEHASH;
  bytes32 internal immutable _BULK_ORDER_TYPEHASH;
  uint256 internal immutable _CHAIN_ID;
  bytes32 internal immutable _DOMAIN_SEPARATOR;
  ConduitControllerInterface internal immutable _CONDUIT_CONTROLLER;
  bytes32 internal immutable _CONDUIT_CREATION_CODE_HASH;

  /// @dev Derive and set hashes, reference chainId, and associated domain
  ///        separator during deployment.
  ///   @param conduitController A contract that deploys conduits, or proxies
  ///                            that may optionally be used to transfer approved
  ///                            ERC20/721/1155 tokens.
  constructor(address conduitController) {
    (_NAME_HASH, _VERSION_HASH, _EIP_712_DOMAIN_TYPEHASH, _OFFER_ITEM_TYPEHASH, _CONSIDERATION_ITEM_TYPEHASH, _ORDER_TYPEHASH, _BULK_ORDER_TYPEHASH) = _deriveTypehashes();
    _CHAIN_ID = block.chainid;
    _DOMAIN_SEPARATOR = _deriveDomainSeparator();
    _CONDUIT_CONTROLLER = ConduitControllerInterface(conduitController);
    (_CONDUIT_CREATION_CODE_HASH, ) = (_CONDUIT_CONTROLLER.getConduitCodeHashes());
  }

  /// @dev Internal view function to derive the EIP-712 domain separator.
  ///   @return The derived domain separator.
  function _deriveDomainSeparator() internal view returns (bytes32) {
    return keccak256(abi.encode(_EIP_712_DOMAIN_TYPEHASH, _NAME_HASH, _VERSION_HASH, block.chainid, address(this)));
  }

  /// @dev Internal pure function to retrieve the default name of this
  ///        contract and return.
  ///   @return The name of this contract.
  function _name() virtual internal pure returns (string memory) {
    assembly {
      mstore(OneWord, OneWord)
      mstore(NameLengthPtr, NameWithLength)
      return(OneWord, ThreeWords)
    }
  }

  /// @dev Internal pure function to retrieve the default name of this contract
  ///        as a string that can be used internally.
  ///   @return The name of this contract.
  function _nameString() virtual internal pure returns (string memory) {
    return "Consideration";
  }

  /// @dev Internal pure function to derive required EIP-712 typehashes and
  ///        other hashes during contract creation.
  ///   @return nameHash                  The hash of the name of the contract.
  ///   @return versionHash               The hash of the version string of the
  ///                                     contract.
  ///   @return eip712DomainTypehash      The primary EIP-712 domain typehash.
  ///   @return offerItemTypehash         The EIP-712 typehash for OfferItem
  ///                                     types.
  ///   @return considerationItemTypehash The EIP-712 typehash for
  ///                                     ConsiderationItem types.
  ///   @return orderTypehash             The EIP-712 typehash for Order types.
  ///   @return bulkOrderTypeHash         The EIP-712 typehash for bulk Order
  ///                                     types.
  function _deriveTypehashes() internal pure returns (bytes32 nameHash, bytes32 versionHash, bytes32 eip712DomainTypehash, bytes32 offerItemTypehash, bytes32 considerationItemTypehash, bytes32 orderTypehash, bytes32 bulkOrderTypeHash) {
    nameHash = keccak256(bytes(_nameString()));
    versionHash = keccak256(bytes("1.1"));
    bytes memory offerItemTypeString = abi.encodePacked("OfferItem(", "uint8 itemType,", "address token,", "uint256 identifierOrCriteria,", "uint256 startAmount,", "uint256 endAmount", ")");
    bytes memory considerationItemTypeString = abi.encodePacked("ConsiderationItem(", "uint8 itemType,", "address token,", "uint256 identifierOrCriteria,", "uint256 startAmount,", "uint256 endAmount,", "address recipient", ")");
    bytes memory orderComponentsPartialTypeString = abi.encodePacked("OrderComponents(", "address offerer,", "address zone,", "OfferItem[] offer,", "ConsiderationItem[] consideration,", "uint8 orderType,", "uint256 startTime,", "uint256 endTime,", "bytes32 zoneHash,", "uint256 salt,", "bytes32 conduitKey,", "uint256 counter", ")");
    eip712DomainTypehash = keccak256(abi.encodePacked("EIP712Domain(", "string name,", "string version,", "uint256 chainId,", "address verifyingContract", ")"));
    offerItemTypehash = keccak256(offerItemTypeString);
    considerationItemTypehash = keccak256(considerationItemTypeString);
    bytes memory orderTypeString = abi.encodePacked(orderComponentsPartialTypeString, considerationItemTypeString, offerItemTypeString);
    orderTypehash = keccak256(orderTypeString);
    bytes memory bulkOrderPartialTypeString = abi.encodePacked("BulkOrder(OrderComponents[2][2][2][2][2][2][2] tree)");
    bulkOrderTypeHash = keccak256(abi.encodePacked(bulkOrderPartialTypeString, considerationItemTypeString, offerItemTypeString, orderComponentsPartialTypeString));
  }
}