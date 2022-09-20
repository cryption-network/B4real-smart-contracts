// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "./library/Ownable.sol";

contract Metadata is Ownable, Initializable {
    function _initMetaOwner(address _owner) internal initializer {
        owner = _owner;
    }

    struct TokenMetadata {
        address routerAddress;
        string imageUrl;
        bool isAdded;
    }

    mapping(address => TokenMetadata) public tokenMeta;

    event URLUpdated(address _tokenAddress, string _tokenUrl);

    function updateMeta(
        address _tokenAddress,
        address _routerAddress,
        string memory _imageUrl
    ) external onlyOwner {
        _updateMeta(_tokenAddress, _routerAddress, _imageUrl);
    }

    function _updateMeta(
        address _tokenAddress,
        address _routerAddress,
        string memory _imageUrl
    ) internal {
        if (_tokenAddress != address(0)) {
            tokenMeta[_tokenAddress] = TokenMetadata({
                routerAddress: _routerAddress,
                imageUrl: _imageUrl,
                isAdded: true
            });
        }
    }

    function updateMetaURL(address _tokenAddress, string memory _imageUrl)
        external
        onlyOwner
    {
        _updateMetaURL(_tokenAddress, _imageUrl);
    }

    function _updateMetaURL(address _tokenAddress, string memory _tokenUrl)
        internal
    {
        TokenMetadata storage meta = tokenMeta[_tokenAddress];
        require(meta.isAdded, "Invalid token address");

        meta.imageUrl = _tokenUrl;

        emit URLUpdated(_tokenAddress, _tokenUrl);
    }
}
