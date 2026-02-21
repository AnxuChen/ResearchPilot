// pages/projects/index.js
Page({

  /**
   * 页面的初始数据
   */
  data: {
    featuredConf: null,
    gridConfs: [],
    allConfs: [],

    showModal: false,
    isEdit: false,
    currentEditId: null,

    formData: {
    abbr: '',
    fullName: '',
    location: '',
    deadline: '',
    progress: 0,
    note: '',
    colorTheme: 'green'
    },
    //颜色列表
    themeOptions: [
        { name: 'Green', value: 'green' },
        { name: 'Purple', value: 'purple' },
        { name: 'Yellow', value: 'yellow' },
        { name: 'Blue', value: 'blue' },
        { name: 'Orange', value: 'orange' }
      ]

  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad: function () {
    // 模拟储存在本地或后端的会议DDL数据
    // 注意：这里的deadline请根据实际情况填写标准的日期格式
    const conferences = [
      { 
        id: 1, 
        abbr: 'CVPR', 
        year: '', 
        location: 'Seattle, USA', 
        fullName: 'Computer Vision and Pattern Recognition', 
        deadline: '2026-02-22', // 假设2天后
        progress: 90, 
        note: 'Abstract registration is closed. Full paper submission only.', 
        colorTheme: 'orange' 
      },
      { 
        id: 2, 
        abbr: 'NeurIPS', 
        year: '', 
        location: 'Vancouver, Canada', 
        fullName: 'Neural Information Processing Systems', 
        deadline: '2026-03-06', // 14天后
        progress: 85, 
        colorTheme: 'green' 
      },
      { 
        id: 3, 
        abbr: 'CHI', 
        year: '', 
        location: 'Yokohama, JP', 
        fullName: 'Human Factors in Computing Systems', 
        deadline: '2026-04-06', // 45天后
        progress: 40, 
        colorTheme: 'purple' 
      },
      { 
        id: 4, 
        abbr: 'ICLR', 
        year: '', 
        location: 'Vienna, Austria', 
        fullName: 'International Conference on Learning Representations', 
        deadline: '2026-05-21', // 3个月后
        progress: 25, 
        colorTheme: 'yellow' 
      },
      { 
        id: 5, 
        abbr: 'AAAI', 
        year: '', 
        location: 'Philadelphia, USA', 
        fullName: 'Association for the Advancement of AI', 
        deadline: '2026-07-20', // 5个月后
        progress: 10, 
        colorTheme: 'blue' 
      }
    ];

    this.setData({
        allConfs: conferences
      });
      this.processConferences(conferences);
  },

  processConferences: function(conferences) {
    const today = new Date().getTime();

    // 1. 计算剩余时间并格式化
    let processedList = conferences.map(conf => {
      const ddlTime = new Date(conf.deadline).getTime();
      const diffTime = ddlTime - today;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      let timeLeftStr = '';
      if (diffDays <= 0) {
        timeLeftStr = 'Passed';
      } else if (diffDays <= 60) {
        timeLeftStr = diffDays + ' Days';
      } else {
        timeLeftStr = Math.round(diffDays / 30) + ' Mos';
      }

      return {
        ...conf,
        diffDays: diffDays,
        timeLeftStr: timeLeftStr
      };
    });

    // 2. 过滤掉已经过期的，并按照距离DDL的远近从小到大排序
    processedList = processedList.filter(c => c.diffDays > 0);
    processedList.sort((a, b) => a.diffDays - b.diffDays);

    // 3. 将最近的一个作为 featuredConf，剩下的作为 gridConfs
    if (processedList.length > 0) {
      this.setData({
        featuredConf: processedList[0],
        gridConfs: processedList.slice(1)
      });
    }

    this.setData({
        allConfs: conferences,
        featuredConf: processedList[0],
        gridConfs: processedList.slice(1)
      }); 
  },

  onEditConference(e) {
    const conf = e.currentTarget.dataset.item;
  
    this.setData({
      showModal: true,
      isEdit: true,
      currentEditId: conf.id,
      formData: { ...conf }
    });
  },
  onAddConference() {
    this.setData({
      showModal: true,
      isEdit: false,
      currentEditId: null,
      formData: {
        abbr: '',
        fullName: '',
        location: '',
        deadline: '',
        progress: 0,
        note: '',
        colorTheme: 'green'
      }
    });
  },
  onInputChange(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      [`formData.${field}`]: e.detail.value
    });
  },
  closeModal() {
    this.setData({ showModal: false });
  },
  onSaveConference() {
    let { allConfs, formData, isEdit, currentEditId } = this.data;
  
    if (isEdit) {
      allConfs = allConfs.map(conf =>
        conf.id === currentEditId ? { ...formData, id: currentEditId } : conf
      );
    } else {
      const newId = Date.now();
      allConfs.push({
        ...formData,
        id: newId
      });
    }
  
    this.setData({
      showModal: false
    });
  
    this.processConferences(allConfs);
  },

  onDeleteConference() {
    const { currentEditId, allConfs } = this.data;
  
    const newList = allConfs.filter(conf => conf.id !== currentEditId);
  
    this.setData({
      showModal: false
    });
  
    this.processConferences(newList);
  },

  // 颜色选择处理函数
  onSelectColor(e) {
    const theme = e.currentTarget.dataset.theme;
    this.setData({
      'formData.colorTheme': theme
    });
  },
  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {

  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {

  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {

  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {

  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {

  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {

  }
})