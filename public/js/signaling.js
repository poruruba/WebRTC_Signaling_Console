const WEBRTC_PING_MESSAGE = "9ca3b441-9558-4ba2-afbf-ebd518ecdc03";
const WEBRTC_PONG_MESSAGE = "9ca3b442-9558-4ba2-afbf-ebd518ecdc03";

class WebrtcSignalingClient{
  constructor(role, url){
    this.role = role;
    this.url = url;
    this.callbacks = [];
  }

  async open(channelId, clientId, password){
    this.channelId = channelId;
    this.clientId = clientId;

    this.ws_socket = new WebSocket(this.url);

    await new Promise((resolve, reject) =>{
      let connected = false;

      // Websocket接続時処理
      this.ws_socket.onopen = (event) => {
  //      console.log("websocket opened", event);

        connected = true;
        resolve();
      };

      this.ws_socket.onerror = (event) =>{
  //      console.error("websocket error", event);

        if( !connected )
          return reject(event);

        var callback = this.callbacks.find(item => item.type == "error" );
        if( callback )
          callback.callback(event);
      };

      this.ws_socket.onclose = (event) =>{
        //      console.log("websocket closed", event);
      
        if( !connected )
          return reject(event);

        var callback = this.callbacks.find(item => item.type == "close" );
        if( callback )
          callback.callback();
      };

      
      this.ws_socket.onmessage = (event) => {
        // Websocket接続維持処理
        if( event.data == WEBRTC_PING_MESSAGE ){
          this.ws_socket.send(WEBRTC_PONG_MESSAGE);
          return;
        }else if( event.data == WEBRTC_PONG_MESSAGE ){
          return;
        }

        var body = JSON.parse(event.data);
  //      console.log("websocket message", body);

        if( body.type == "ready"){
          var callback = this.callbacks.find(item => item.type == "ready" );
          if( callback )
            callback.callback(body.clients, body.clientId);
        }else
        if( body.type == "sdpOffer1" || body.type == "sdpOffer2" || body.type == "sdpAnswer" || body.type == "iceCandidate" ){
          var callback = this.callbacks.find(item => item.type == body.type );
          if( callback )
            callback.callback(body.data, body.clientId);
        }else
        if( body.type == 'error' ){
          var callback = this.callbacks.find(item => item.type == "error" );
          if( callback )
            callback.callback(body.message);
        }
      };
    });

    // readyの送信
    this.ws_socket.send(JSON.stringify({
      type: "ready",
      role: this.role,
      clientId: this.clientId,
      channelId: this.channelId,
      password: password
    }));

    var callback = this.callbacks.find(item => item.type == "open" );
    if( callback )
      callback.callback();
  }

  close(){
    this.ws_socket.close();
    this.callbacks = [];
    this.channelId = null;
    this.clientId = null;
  }

  // type=ready, open, ready, sdpOffer, sdpAnswer, iceCandidate, close, error
  on(type, callback){
    var item = this.callbacks.find(item => item.type == type);
    if(!item){
      this.callbacks.push({ type: type, callback: callback});
    }else{
      item.callback = callback;
    }
  }

  sendSdpOffer1(offer, remoteClientId){
    this.ws_socket.send(JSON.stringify({
      type: "sdpOffer1",
      clientId: this.clientId,
      channelId: this.channelId,
      target: remoteClientId,
      data: offer
    }));
  }

  sendSdpOffer2(offer, remoteClientId){
    this.ws_socket.send(JSON.stringify({
      type: "sdpOffer2",
      clientId: this.clientId,
      channelId: this.channelId,
      target: remoteClientId,
      data: offer
    }));
  }

  sendIceCandidate(candidate, remoteClientId){
    this.ws_socket.send(JSON.stringify({
      type: "iceCandidate",
      clientId: this.clientId,
      channelId: this.channelId,
      target: remoteClientId,
      data: candidate
    }));
  }

  sendSdpAnswer(answer, remoteClientId){
    this.ws_socket.send(JSON.stringify({
      type: "sdpAnswer",
      clientId: this.clientId,
      channelId: this.channelId,
      target: remoteClientId,
      data: answer,
    }));
  }  
}
