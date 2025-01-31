//user 테이블 객체 생성
const { sequelize } = require("../models");
const db = require("../models");
const User = require("../models/user");
db.User = User;
User.init(sequelize);

const jwt = require("jsonwebtoken");
require("dotenv").config();

const bcryptjs = require("bcryptjs");

const Web3 = require("web3");
const web3 = new Web3(new Web3.providers.HttpProvider("http://127.0.0.1:7545")); // 가나슈와 연동(로컬)
const Tx = require("ethereumjs-tx").Transaction;

//Truffle로 배포한 컨트랙 정보 읽어오기
// 선행 작업 : 터미널에서 truffle --reset
//로컬에서 배포시 Address가 다 다르기 때문에 ABI, Address 파일 형태로 저장하도록 했습니다! -> contract/2_initial_migration.js 확인하시면 됩니다!
const fs = require("fs");
var DEPLOYED_ABI = JSON.parse(
  fs.readFileSync("../contract/20deployedABI", "utf8")
);
var DEPLOYED_ADDRESS = fs
  .readFileSync("../contract/20deployedAddress", "utf8")
  .replace(/\n|\r/g, "");
const Contract20 = new web3.eth.Contract(DEPLOYED_ABI, DEPLOYED_ADDRESS);

const userInfo = async (req, res) => {
  console.log(req.params.uid);

  // 유저 정보
  const user = await User.findOne({
    where: {
      login_id: req.params.uid,
    },
  });
  if (user == null) {
    return res.status(404).json({ data: null });
  }

  var userInfo = user.dataValues;

  // 포스팅 정보
  const posts = await user.getPosts();
  var postInfo_arr = [];
  posts.forEach((element) => {
    postInfo_arr.push(element.dataValues);
  });
  console.log(postInfo_arr);

  // NFT 정보
  const nfts = await user.getNFTs();
  var nftInfo_arr = [];
  nfts.forEach((element) => {
    nftInfo_arr.push(element.dataValues);
  });
  console.log(nftInfo_arr);

  return res.status(200).json({
    message: "success",
    data: {
      userData: userInfo,
      postData: postInfo_arr,
      nftData: nftInfo_arr,
    },
  });
};

const join = async (req, res) => {
  //DB에 넣기
  const { user_id, nickname, password } = req.body;

  // 비밀번호 해싱
  let hashedPassword;
  try {
    hashedPassword = await bcryptjs.hash(password, 12); // 해싱할 값, 솔트 값
  } catch (err) {
    console.log(err);
  }

  // Create a new user
  var userData = {
    login_id: user_id,
    nickname: nickname,
    password: hashedPassword, // 해싱값
    address: "",
    token_amount: 0,
    eth_amount: 0,
  };

  //이미 있는 login_id 검사
  const loginIdSearch = await User.findOne({ where: { login_id: user_id } });
  if (loginIdSearch != null) {
    return res.status(400).json({ message1: "userId already exists" });
  }

  //이미 있는 nickname 검사
  const nicknameSearch = await User.findOne({ where: { nickname: nickname } });
  if (nicknameSearch != null) {
    return res.status(400).json({ message2: "nickname already exists" });
  }

  //블록체인 계정 생성 및 잔액 userData에 업데이트
  const new_account = await web3.eth.accounts.create();
  const address = new_account.address;
  const privateKey = new_account.privateKey;
  userData.address = address;

  console.log(userData);

  //DB Insert
  const newUser = await User.create(userData);

  // newUser가 성공적으로 insert 되었을 경우, JWT 발급
  if (newUser != null) {
    delete userData.password; // 패스워드 제외

    //jwt
    var accessToken = jwt.sign(userData, process.env.ACCESS_SECRET, {
      expiresIn: "5m",
    });
    var refreshToken = jwt.sign(userData, process.env.REFRESH_SECRET, {
      expiresIn: "5m",
    });

    res.cookie("refreshToken", refreshToken);
  }

  userData["privateKey"] = privateKey;
  console.log(userData);

  return res
    .status(200)
    .json({ message: "success", accessToken: accessToken, userInfo: userData });
};

const login = async (req, res) => {
  console.log(req.body);

  const { user_id, password } = req.body;

  //이미 있는 login_id 검사
  const loginIdSearch = await User.findOne({ where: { login_id: user_id } });
  // console.log(loginIdSearch.dataValues)

  if (loginIdSearch != null) {
    // 해당 user_id가 있을 경우

    var userData = {}; // 유저 정보 담을 객체
    userData = loginIdSearch.dataValues;

    let isValidPassword = false;
    if (
      (isValidPassword = await bcryptjs.compare(password, userData.password)) // 해싱값 비교
    ) {
      // 비밀번호 일치

      delete userData.password; // 비밀번호 제외
      delete userData.id; // DB id 제외

      //JWT 발급
      var accessToken = jwt.sign(userData, process.env.ACCESS_SECRET, {
        expiresIn: "30m",
      });
      var refreshToken = jwt.sign(userData, process.env.REFRESH_SECRET, {
        expiresIn: "30m",
      });

      res.cookie("refreshToken", refreshToken);

      return res.status(200).json({
        message: "success",
        accessToken: accessToken,
        userInfo: userData,
      });
    } else {
      // 비밀번호 불일치
      return res.status(400).json({ message: "Unauthrized" });
    }
  } else {
    // 해당 user_id가 없을 경우
    return res.status(400).json({ message: "Unauthrized" });
  }
};

const transfer20 = async (req, res) => {
  console.log(req.body);

  const { user_id, password, private_key, recipient, transfer_amount } =
    req.body;

  //recipient가 유효한 계정인지
  const recipientSearch = await User.findOne({
    where: { login_id: recipient },
  });
  if (recipientSearch == null) {
    console.log("Invaild Recipient");
    return res.status(404).json({ message: "Invaild Recipient" });
  }

  //recipient 계정 주소 저장
  const recipientAddress = recipientSearch.dataValues.address;

  //accessToken 검증
  if (req.headers.authorization) {
    // 헤더 정보 있
    const token = req.headers.authorization.replace(/^Bearer\s+/, "");

    jwt.verify(token, process.env.ACCESS_SECRET, async (err, decoded) => {
      if (err) {
        return res.status(404).json({ message: "invalid access token" });
      } else {
        // 인증 완료

        //Transfer
        try {
          // 이부분은 테스트를 위한 서버 첫번째 계정에서 특정 계정으로 ERC20토큰을 보내는 로직입니다.
          // 서버는 네트워크에 등록되어 있어 서명 X(Ganache에서 가지고 있음)
          // const accounts = await web3.eth.getAccounts();
          // const serverAccount = accounts[0];
          // await Contract20.methods.transfer(decoded.address,200).send({from: serverAccount});
          // var tokenBalance = await Contract20.methods.balanceOf(decoded.address).call(); // 컨트랙 내부 함수 호출(단순 조회일 경우, 트랜잭션을 발생시키지 않기 때문에 send가 아닌 call로)
          // console.log(tokenBalance)

          const tokenBalanceCheck = await Contract20.methods
            .balanceOf(decoded.address)
            .call();
          if (tokenBalanceCheck < transfer_amount) {
            return res.status(404).json({ message: "Not Enough Token" });
          }
          // 토큰 전송 트랜잭션 발생 : (토큰 수신자 주소, 전송 토큰 양) 인자, send를 통해 트랜잭션 발생(이때, erc20.sol에 따라 토큰 보유자만 전송 가능)

          // 우선 사용자가 해당 트랜잭션을 사용할 가스비가 있는 지 확인
          //네트워크 가스비 책정
          var gasPrice = await web3.eth.getGasPrice(function (error, result) {
            return result;
          });

          // sender의 이더 조회
          var balance = await web3.eth.getBalance(decoded.address);
          console.log(gasPrice, balance);

          // sender가 충분한 가스비가 없을 경우
          if (parseInt(gasPrice) > parseInt(balance)) {
            return res.status(404).json({ message: "Not Enough Gas Price" });
          }

          //sender의 tokenBalance 조회
          var SenderTokenBalance = await Contract20.methods
            .balanceOf(decoded.address)
            .call();

          console.log(SenderTokenBalance);
          console.log(transfer_amount);
          if (parseInt(SenderTokenBalance) < parseInt(transfer_amount)) {
            return res.status(404).json({ message: "Not Enough Token" });
          }

          //SignTX를 위한 Buffer형태로 변환
          const privateKey = private_key.substr(2);
          console.log(privateKey);
          const privateKey_B = Buffer.from(privateKey, "hex");

          //컨트랙에서 넌스값 구하기
          const accountNonce =
            "0x" +
            (await web3.eth.getTransactionCount(decoded.address)).toString(16);

          //트랜잭션 데이터 생성
          const rawTx = {
            nonce: accountNonce,
            from: decoded.address,
            to: DEPLOYED_ADDRESS, // 컨트랙에게 전송
            gasPrice: web3.utils.toHex(gasPrice),
            gasLimit: 500000,
            value: "0x0",
            // 컨트랙 함수 실행
            data: Contract20.methods
              .transfer(recipientAddress, transfer_amount)
              .encodeABI(),
          };

          // 트랜잭션 생성 및 서명
          var tx = new Tx(rawTx);
          tx.sign(privateKey_B);
          var serializedTx = "0x" + tx.serialize().toString("hex");

          var txHash;
          // 서명 및 전송
          await web3.eth
            .sendSignedTransaction(serializedTx.toString("hex"))
            .then(function (receipt) {
              console.log(receipt.transactionHash);
              txHash = receipt.transactionHash;
            })
            .catch(function (error) {
              console.log(error);
            });

          //토큰 전송 후 DB 업데이트(토큰 잔액)
          var SenderTokenBalance = await Contract20.methods
            .balanceOf(decoded.address)
            .call(); // 컨트랙 내부 함수 호출(단순 조회일 경우, 트랜잭션을 발생시키지 않기 때문에 send가 아닌 call로)
          var RecipientTokenBalance = await Contract20.methods
            .balanceOf(recipientAddress)
            .call(); // 컨트랙 내부 함수 호출(단순 조회일 경우, 트랜잭션을 발생시키지 않기 때문에 send가 아닌 call로)

          console.log(SenderTokenBalance);
          console.log(RecipientTokenBalance);

          //DB에 잔액 업데이트
          // Sender
          await User.update(
            {
              token_amount: SenderTokenBalance,
            },
            {
              where: { address: decoded.address },
            }
          );

          //Recipient
          await User.update(
            {
              token_amount: RecipientTokenBalance,
            },
            {
              where: { address: recipientAddress },
            }
          );

          return res
            .status(200)
            .json({ message: "Transfer success", data: { tx: txHash } });
        } catch (e) {
          console.log("Invaild TX");
          console.log(e);
          return res.status(404).json({ message: "Invaild Tx" });
        }
      }
    });
  } else {
    return res.status(404).json({ message: "Invalid access token" });
  }
};

exports.userInfo = userInfo;
exports.join = join;
exports.login = login;
exports.transfer20 = transfer20;

const newTopic = async (req, res) => {
  const { title, content, img_url } = req.body;
  let info = {
    title: title,
    content: content,
    img_url: img_url,
    user_id: req.userId,
  };
  const topic = await Post.create(info);
  // res.status(200).send(topic);

  // 유저 정보
  const user = await User.findOne({
    where: {
      id: info.user_id,
    },
  });
  if (user == null) {
    return res.status(404).json({ data: null });
  }

  const userAccount = user.dataValues.address;

  const serverAccounts = await web3.eth.getAccounts();
  console.log(serverAccounts[0]);

  await Contract20.methods
    .transfer(userAccount, "1")
    .send({ from: serverAccounts[0] })
    .then((data) => {
      console.log(data);
    });

  //토큰 전송 후 DB 업데이트(토큰 잔액)
  var UserTokenBalance = await Contract20.methods.balanceOf(userAccount).call(); // 컨트랙 내부 함수 호출(단순 조회일 경우, 트랜잭션을 발생시키지 않기 때문에 send가 아닌 call로)
  var ServerTokenBalance = await Contract20.methods
    .balanceOf(serverAccounts[0])
    .call(); // 컨트랙 내부 함수 호출(단순 조회일 경우, 트랜잭션을 발생시키지 않기 때문에 send가 아닌 call로)

  console.log(UserTokenBalance);
  console.log(ServerTokenBalance);
};
