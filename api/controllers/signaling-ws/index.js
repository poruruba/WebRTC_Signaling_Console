'use strict';

const HELPER_BASE = process.env.HELPER_BASE || "/opt/";
const Response = require(HELPER_BASE + 'response');
//const Redirect = require(HELPER_BASE + 'redirect');

const APIKEY = process.env.SIGNALING_APIKEY || "abcdefg";

const WEBRTC_PING_MESSAGE = "9ca3b441-9558-4ba2-afbf-ebd518ecdc03";
const WEBRTC_PONG_MESSAGE = "9ca3b442-9558-4ba2-afbf-ebd518ecdc03";
const WEBRTC_PING_INTERVAL = 25000;

let channel_list = [];
let ping_interval_id = 0;

exports.handler = async (event, context, callback) => {
	// console.log(event);
  if (event.path == "/signaling-get"){
    // APIキーのチェック
    if( event.queryStringParameters.apikey != APIKEY ){
      console.log("invalid apikey");
      throw new Error("invalid apikey");
    }
    // チャネルリストの返却
  	return new Response(channel_list);
  }else
  {
    console.log("unknown endpoint");
    throw new Error("unknown endpoint");
  }
};

exports.ws_handler = async (event, context) => {
//  console.log(event);
//  console.log(context);

  // Websocketの接続維持
  if( event.body == WEBRTC_PING_MESSAGE ){
    await context.wslib.postToConnection({
      ConnectionId: event.requestContext.connectionId,
      Data: WEBRTC_PONG_MESSAGE
    }, null);
    return { statusCode: 200 };
  }else if( event.body == WEBRTC_PONG_MESSAGE ){
    return { statusCode: 200 };
  }

  try{
    var body = JSON.parse(event.body);

    // チャネルの検索
    var channel_item = channel_list.find(item => item.channelId == body.channelId );
    if( !channel_item ){
      channel_item = {
        channelId: body.channelId,
        password: body.password,
        clients: [],
      };
      channel_list.push(channel_item);
    }

    // クライアントの検索
    var client_item;
    if( body.type == "ready" ){
      // クライアントからの接続
      // パスワードのチェック
      if( channel_item.password != body.password ){
        console.log("invalid password");
        await context.wslib.postToConnection({
          ConnectionId: event.requestContext.connectionId,
          Data: JSON.stringify({
            type: "error",
            clientId: body.clientId,
            message: "invalid password"
          })
        }, null);
        return { statusCode: 200 };
      }
      // クライアントの再登録
      var index = channel_item.clients.findIndex(item => item.clientId == body.clientId );
      if( index >= 0 ){
        channel_item.clients.splice(index, 1);
      }
      client_item = {
        role: body.role,
        connectionId: event.requestContext.connectionId,
        clientId: body.clientId,
      };
      channel_item.clients.push(client_item);
    }else{
      // クライアントの検索
      client_item = channel_item.clients.find(item => item.clientId == body.clientId);
      if( !client_item ){
        console.log("unknown clientId");
        throw new Error("unknown clientId");
      }
      // コネクションIDのチェック
      if( client_item.connectionId != event.requestContext.connectionId ){
        console.log("invalid connection");
        throw new Error("invalid connection");
      }
    }


    // 応答処理
    if( body.type == "ready"){
      // for クライアントからの接続
      if( client_item.role == "master" ){
        // masterの場合：各クライアントにreadyを返却
        for( let item of channel_item.clients ){
          if( item.clientId == client_item.clientId || item.role == 'master')
            continue;
          await context.wslib.postToConnection({
            ConnectionId: item.connectionId,
            Data: JSON.stringify({
              type: "ready",
              clientId: client_item.clientId,
              clients: [{
                role: client_item.role,
                clientId: client_item.clientId
              }]
            })
          }, null);
        }
      }else
      if( client_item.role == "slave" ){
        // slaveの場合： 現在コネクションの返却
        var clients = [];
        for( let item of channel_item.clients ){
          if( item.clientId == client_item.clientId )
            continue;
          clients.push({
            role: item.role,
            clientId: item.clientId
          });
        }
        await context.wslib.postToConnection({
          ConnectionId: client_item.connectionId,
          Data: JSON.stringify({
            type: "ready",
            clientId: client_item.clientId,
            clients: clients
          })
        }, null);
      }   
    }else
    if( body.type == "sdpAnswer" || body.type == "sdpOffer" || body.type == "iceCandidate" ){
      // 通信内容をターゲットクライアントに転送
      var item = channel_item.clients.find(item => item.clientId == body.target );
      if( item ){
        await context.wslib.postToConnection({
          ConnectionId: item.connectionId,
          Data: JSON.stringify({
            type: body.type,
            clientId: client_item.clientId,
            data: body.data
          })
        }, null);
      }
    } 

    return { statusCode: 200 };
  }catch(error){
    console.error(error);
  }
};

function loop_ping(wslib){
  wslib.getConnectionList((err, list) =>{
    if( err )
      return;
    for( let item of list){
      wslib.postToConnection({
        ConnectionId: item,
        Data: WEBRTC_PING_MESSAGE
      }, null);
    }
  });
}

exports.connect_handler = async (event, context) => {
  console.log("connect_handler");

  // 接続維持の開始
  if( ping_interval_id == 0 ){
    ping_interval_id = setInterval(() =>{
      loop_ping(context.wslib);
    }, WEBRTC_PING_INTERVAL );
  }

  return { statusCode: 200 };
};

exports.disconnect_handler = async (event, context) => {
  console.log("disconnect_handler");

  // チャネルリストの更新
  var list = [];
  for( let channel of channel_list ){
    var clients = [];
    for( let client of channel.clients ){
      if( client.connectionId != event.requestContext.connectionId )
        clients.push(client);
    }
    if( clients.length > 0 ){
      channel.clients = clients;
      list.push(channel);
    }
  }
  channel_list = list;

  context.wslib.getConnectionList((err, list) =>{
    if( err )
      return;
    if( list.length == 0 ){
      // 接続維持の停止
      clearInterval(ping_interval_id);
      ping_interval_id = 0;
    }
  });

  return { statusCode: 200 };
};
