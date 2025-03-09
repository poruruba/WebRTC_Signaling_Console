'use strict';

const HELPER_BASE = process.env.HELPER_BASE || "/opt/";
const Response = require(HELPER_BASE + 'response');
const Redirect = require(HELPER_BASE + 'redirect');

const APIKEY = process.env.SIGNALING_APIKEY || "abcdefg";

const WEBRTC_PING_MESSAGE = "9ca3b441-9558-4ba2-afbf-ebd518ecdc03";
const WEBRTC_PONG_MESSAGE = "9ca3b442-9558-4ba2-afbf-ebd518ecdc03";
const WEBRTC_PING_INTERVAL = 25000;

var channel_list = [];
var ping_interval_id = 0;

exports.handler = async (event, context, callback) => {
	// var body = JSON.parse(event.body);
	// console.log(body);
  if (event.path == "/signaling-get"){
    if( event.queryStringParameters.apikey != APIKEY )
      throw new Error("invalid apikey");
  	return new Response(channel_list);
  }else
  {
    throw new Error("unknown endpoint");
  }
};

exports.ws_handler = async (event, context) => {
//  console.log(event);
//  console.log(context);

  if( event.body == WEBRTC_PING_MESSAGE ){
    await context.wslib.postToConnection({
      ConnectionId: event.requestContext.connectionId,
      Data: WEBRTC_PONG_MESSAGE
    }, null);
    return;
  }else if( event.body == WEBRTC_PONG_MESSAGE ){
    return;
  }

  var body = JSON.parse(event.body);

  var channel_item = channel_list.find(item => item.channelId == body.channelId );
  if( !channel_item ){
    channel_item = {
      channelId: body.channelId,
      password: body.password,
      clients: [],
    };
    channel_list.push(channel_item);
  }

  try{
    var client_item;
    if( body.type == "ready" ){
      if( body.apikey != APIKEY ){
	console.log("invalid apikey");
        await context.wslib.postToConnection({
          ConnectionId: event.requestContext.connectionId,
          Data: JSON.stringify({
            type: "error",
            clientId: body.clientId,
            message: "invalid apikey"
          })
        }, null);
        return { statusCode: 200 };
      }
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
      client_item = channel_item.clients.find(item => item.clientId == body.clientId);
      if( !client_item )
        throw new Error("unknown clientId");
    }


    if( body.type == "ready"){
      if( client_item.role == "master" ){
        for( let item of channel_item.clients ){
          if( item.role == 'master' || item.clientId == client_item.clientId )
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
      }else if( client_item.role == "slave" ){
        var clients = [];
        for( let item of channel_item.clients ){
          if( item.clientId != client_item.clientId )
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
    if( body.type == "answer"){
      var item = channel_item.clients.find(item => item.clientId == body.target );
      if( item ){
        await context.wslib.postToConnection({
          ConnectionId: item.connectionId,
          Data: JSON.stringify({
            type: "answer",
            clientId: client_item.clientId,
            answer: body.answer
          })
        }, null);
      }
    }else
    if( body.type == "offer" ){
      var item = channel_item.clients.find(item => item.clientId == body.target );
      if( item ){
        await context.wslib.postToConnection({
          ConnectionId: item.connectionId,
          Data: JSON.stringify({
            type: "offer",
            clientId: client_item.clientId,
            offer: body.offer
          })
        }, null);
      }
    }else
    if( body.type == "candidate" ){
      var item = channel_item.clients.find(item => item.clientId == body.target );
      if( item ){
        await context.wslib.postToConnection({
          ConnectionId: item.connectionId,
          Data: JSON.stringify({
            type: "candidate",
            clientId: client_item.clientId,
            candidate: body.candidate
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

  if( ping_interval_id == 0 ){
    ping_interval_id = setInterval(() =>{
      loop_ping(context.wslib);
    }, WEBRTC_PING_INTERVAL );
  }

  return { statusCode: 200 };
};

exports.disconnect_handler = async (event, context) => {
  console.log("disconnect_handler");

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
      clearInterval(ping_interval_id);
      ping_interval_id = 0;
    }
  });

  return { statusCode: 200 };
};
